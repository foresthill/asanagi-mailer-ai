use tauri::Manager;

/// Release builds run the bundled Next.js standalone server with a **bundled
/// Node runtime** and point the window at it; dev builds use `devUrl` (next dev
/// on :3100).
///
/// The standalone bundle (`.next-standalone/standalone`) ships as the resource
/// `server/`, and the Node 24 binary ships as the resource `node` (see
/// tauri.conf.json `bundle.resources`; the binary is fetched in CI). The machine
/// no longer needs Node installed — we copy the bundled binary to a writable app
/// dir (the resource dir can be read-only, e.g. an AppImage mount), mark it
/// executable, and run it.
const SERVER_PORT: u16 = 3100;

/// Resolve a runnable Node: the bundled binary lives in the (possibly read-only)
/// resource dir, so copy it once into the writable app-data dir and set +x.
/// Returns the resource copy as a fallback if no writable dir is available.
fn ensure_node(resource_dir: &std::path::Path, data_dir: Option<&std::path::Path>) -> std::path::PathBuf {
    let bundled = resource_dir.join("node");
    let Some(d) = data_dir else { return bundled };
    let dest = d.join("runtime-node");
    // Copy when missing or a size mismatch (cheap freshness check across upgrades).
    let need_copy = match (std::fs::metadata(&dest), std::fs::metadata(&bundled)) {
        (Ok(a), Ok(b)) => a.len() != b.len(),
        _ => true,
    };
    if need_copy {
        if let Err(e) = std::fs::copy(&bundled, &dest) {
            log::error!("copy bundled node failed ({}): {e}", bundled.display());
            return bundled; // try the resource copy directly (may still be +x)
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }
    dest
}

fn start_server(handle: &tauri::AppHandle) {
    let resource_dir = match handle.path().resource_dir() {
        Ok(d) => d,
        Err(e) => {
            log::error!("resource_dir unavailable: {e}");
            return;
        }
    };
    let server_js = resource_dir.join("server").join("server.js");
    let server_root = server_js
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| resource_dir.clone());

    // .data（トークン・SQLite・設定）は設置先(読み取り専用のことがある)ではなく
    // OSのユーザーアプリデータ領域へ書く。Nodeサーバは ASANAGI_DATA_DIR を尊重する。
    let data_dir = handle.path().app_data_dir().ok();
    if let Some(ref d) = data_dir {
        let _ = std::fs::create_dir_all(d);
    }

    let node_bin = ensure_node(&resource_dir, data_dir.as_deref());
    let mut cmd = std::process::Command::new(&node_bin);
    cmd.arg(&server_js)
        .env("PORT", SERVER_PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .current_dir(&server_root);
    if let Some(ref d) = data_dir {
        cmd.env("ASANAGI_DATA_DIR", d);
        log::info!("ASANAGI_DATA_DIR = {}", d.display());
    }

    // Capture the bundled Node server's stdout/stderr to a log the user can
    // inspect, so a startup crash is diagnosable instead of a silent hang.
    if let Some(ref d) = data_dir {
        if let Ok(f) = std::fs::File::create(d.join("server.log")) {
            if let Ok(f2) = f.try_clone() {
                cmd.stdout(std::process::Stdio::from(f));
                cmd.stderr(std::process::Stdio::from(f2));
            }
        }
    }

    match cmd.spawn() {
        Ok(_) => log::info!("started standalone server: {}", server_js.display()),
        Err(e) => log::error!("failed to start server ({}): {e}", server_js.display()),
    }

    let handle = handle.clone();
    std::thread::spawn(move || {
        // Wait (up to ~20s) for the server to accept connections, then load it.
        let mut up = false;
        for _ in 0..80 {
            if std::net::TcpStream::connect(("127.0.0.1", SERVER_PORT)).is_ok() {
                up = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        if let Some(win) = handle.get_webview_window("main") {
            if up {
                match format!("http://localhost:{SERVER_PORT}").parse() {
                    Ok(url) => {
                        let _ = win.navigate(url);
                    }
                    Err(e) => log::error!("bad server url: {e}"),
                }
            } else {
                // The server never came up — show an actionable error instead of
                // a blank/frozen window.
                log::error!("server did not start within timeout");
                let _ = win.eval(
                    "document.documentElement.innerHTML = '<div style=\"font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1.5rem;line-height:1.8;color:#222\"><h2>ローカルサーバを起動できませんでした</h2><p>Node ランタイムはアプリに同梱されているため、通常インストールは不要です。何度か再起動しても直らない場合は、詳細エラーをご確認ください。</p><p>詳細エラーはデータフォルダ内の <code>server.log</code> に出力されています（Linux: <code>~/.local/share</code> 配下）。この内容を開発者にお知らせください。</p></div>'",
                );
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            } else {
                start_server(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
