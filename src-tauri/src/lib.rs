use tauri::Manager;

/// Release builds run the bundled Next.js standalone server (system Node) and
/// point the window at it; dev builds use `devUrl` (next dev on :3100).
///
/// The standalone bundle (`.next-standalone/standalone`) is shipped as the
/// app resource `server/` (see tauri.conf.json `bundle.resources`). Requires
/// Node.js 24 on the machine — see docs/DESKTOP.md. A future revision can bundle
/// a Node binary as a sidecar to drop that requirement.
const SERVER_PORT: u16 = 3100;

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
        .unwrap_or(resource_dir);

    // .data（トークン・SQLite・設定）は設置先(読み取り専用のことがある)ではなく
    // OSのユーザーアプリデータ領域へ書く。Nodeサーバは ASANAGI_DATA_DIR を尊重する。
    let data_dir = handle.path().app_data_dir().ok();
    if let Some(ref d) = data_dir {
        let _ = std::fs::create_dir_all(d);
    }

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&server_js)
        .env("PORT", SERVER_PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .current_dir(&server_root);
    if let Some(ref d) = data_dir {
        cmd.env("ASANAGI_DATA_DIR", d);
        log::info!("ASANAGI_DATA_DIR = {}", d.display());
    }

    // Capture the Node server's stdout/stderr to a log the user can inspect, so
    // a startup crash (e.g. Node too old for node:sqlite → needs Node 22.5+/24,
    // or `node` missing from PATH) is diagnosable instead of a silent hang.
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
                    "document.documentElement.innerHTML = '<div style=\"font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1.5rem;line-height:1.8;color:#222\"><h2>ローカルサーバを起動できませんでした</h2><p>このアプリは Node.js を使ってローカルで動作します。<b>Node.js 24（22.5 以上）</b>が必要です。</p><ol><li>ターミナルで <code>node --version</code> を確認（22.5 未満なら <a href=\"https://nodejs.org\">nodejs.org</a> から 24 を導入）</li><li>Node をインストール後、アプリを再起動</li></ol><p>詳細エラーはデータフォルダ内の <code>server.log</code> に出力されています（Linux: <code>~/.local/share</code> 配下）。</p></div>'",
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
