use std::path::{Path, PathBuf};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Manager;

/// Open a file or folder with the OS default handler (file manager / text
/// viewer). Used by the Help menu so users can reach logs from the GUI instead
/// of `cat` — and it works even when the Next.js server never started.
fn open_in_os(path: &Path) {
    #[cfg(target_os = "linux")]
    let prog = "xdg-open";
    #[cfg(target_os = "macos")]
    let prog = "open";
    #[cfg(target_os = "windows")]
    let prog = "explorer";
    if let Err(e) = std::process::Command::new(prog).arg(path).spawn() {
        log::error!("open_in_os failed for {}: {e}", path.display());
    }
}

/// Read the last ~`max` bytes of a log file for display (whole file if smaller).
/// Returns a placeholder line when the file is missing/unreadable so the error
/// page always shows *something* rather than a blank.
fn read_log_tail(path: &Path, max: u64) -> String {
    match std::fs::read(path) {
        Ok(bytes) => {
            let start = bytes.len().saturating_sub(max as usize);
            String::from_utf8_lossy(&bytes[start..]).into_owned()
        }
        Err(e) => format!("(読み込めません: {} — {e})", path.display()),
    }
}

/// Release builds run the bundled Next.js standalone server with a **bundled
/// Node runtime** and point the window at it; dev builds use `devUrl` (next dev
/// on :3100).
///
/// The standalone bundle (`.next-standalone/standalone`) ships as the resource
/// `server/`, and the Node binary ships as the resource `node` (see
/// tauri.conf.json `bundle.resources`; the binary is fetched in CI). The machine
/// no longer needs Node installed — we copy the bundled binary to a writable app
/// dir (the resource dir can be read-only, e.g. an AppImage mount), mark it
/// executable, and run it. If the bundled binary can't run on this machine
/// (glibc/arch mismatch), we fall back to a system `node` on PATH.

/// Pick a free localhost port instead of a hard-coded one — a fixed port
/// (3100) collides with dev servers / other apps and makes the server die with
/// EADDRINUSE. Falls back to 3100 if the probe fails.
fn free_port() -> u16 {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(3100)
}

/// Resolve a runnable Node: the bundled binary lives in the (possibly read-only)
/// resource dir, so copy it once into the writable app-data dir and set +x.
/// Returns the resource copy as a fallback if no writable dir is available.
fn ensure_node(resource_dir: &Path, data_dir: Option<&Path>) -> PathBuf {
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

/// Does this `node` binary actually run here? Runs `node --version` and logs the
/// result — turns a silent "server never started" into a diagnosable line
/// (e.g. a GLIBC/arch error on stderr) in the app log.
fn node_works(bin: &Path) -> bool {
    match std::process::Command::new(bin).arg("--version").output() {
        Ok(o) if o.status.success() => {
            log::info!(
                "node OK: {} {}",
                bin.display(),
                String::from_utf8_lossy(&o.stdout).trim()
            );
            true
        }
        Ok(o) => {
            log::error!(
                "node --version failed for {}: status={} stderr={}",
                bin.display(),
                o.status,
                String::from_utf8_lossy(&o.stderr).trim()
            );
            false
        }
        Err(e) => {
            log::error!("node not executable ({}): {e}", bin.display());
            false
        }
    }
}

/// A system Node on PATH / common locations, used only if the bundled one can't
/// run (glibc/arch mismatch). Must satisfy node:sqlite (Node ≥ 22.5).
fn system_node() -> Option<PathBuf> {
    let mut cands: Vec<PathBuf> = vec![PathBuf::from("node")]; // PATH lookup
    for p in [
        "/usr/local/bin/node",
        "/usr/bin/node",
        "/opt/homebrew/bin/node",
        "/snap/bin/node",
    ] {
        cands.push(PathBuf::from(p));
    }
    cands.into_iter().find(|p| node_works(p))
}

/// Resolve the Node to run: bundled first, else a system fallback.
fn resolve_node(resource_dir: &Path, data_dir: Option<&Path>) -> PathBuf {
    let bundled = ensure_node(resource_dir, data_dir);
    if node_works(&bundled) {
        return bundled;
    }
    log::warn!("bundled node unusable on this machine; trying a system node");
    system_node().unwrap_or(bundled)
}

fn start_server(handle: &tauri::AppHandle) {
    let resource_dir = match handle.path().resource_dir() {
        Ok(d) => d,
        Err(e) => {
            log::error!("resource_dir unavailable: {e}");
            return;
        }
    };
    log::info!("resource_dir = {}", resource_dir.display());
    let server_js = resource_dir.join("server").join("server.js");
    let server_root = server_js
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| resource_dir.clone());
    if !server_js.exists() {
        log::error!("server.js missing at {}", server_js.display());
    }

    // .data（トークン・SQLite・設定）は設置先(読み取り専用のことがある)ではなく
    // OSのユーザーアプリデータ領域へ書く。Nodeサーバは ASANAGI_DATA_DIR を尊重する。
    let data_dir = handle.path().app_data_dir().ok();
    if let Some(ref d) = data_dir {
        let _ = std::fs::create_dir_all(d);
    }

    let port = free_port();
    log::info!("chosen server port = {port}");
    let node_bin = resolve_node(&resource_dir, data_dir.as_deref());
    let mut cmd = std::process::Command::new(&node_bin);
    cmd.arg(&server_js)
        .env("PORT", port.to_string())
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
        Ok(_) => log::info!(
            "spawned standalone server: {} {}",
            node_bin.display(),
            server_js.display()
        ),
        Err(e) => log::error!(
            "failed to spawn server (node={}, server={}): {e}",
            node_bin.display(),
            server_js.display()
        ),
    }

    let handle = handle.clone();
    let data_dir_for_thread = data_dir.clone();
    std::thread::spawn(move || {
        // Wait (up to ~20s) for the server to accept connections, then load it.
        let mut up = false;
        for _ in 0..80 {
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                up = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        if let Some(win) = handle.get_webview_window("main") {
            if up {
                log::info!("server up on {port}; navigating window");
                match format!("http://localhost:{port}").parse() {
                    Ok(url) => {
                        let _ = win.navigate(url);
                    }
                    Err(e) => log::error!("bad server url: {e}"),
                }
            } else {
                // The server never came up — show an actionable error with the
                // actual logs embedded (+ a Copy button), so the user doesn't
                // need a terminal / `cat`. The Help menu opens the same logs.
                log::error!("server did not start within timeout (port {port})");
                let app_log = handle
                    .path()
                    .app_log_dir()
                    .ok()
                    .map(|d| d.join("asanagi.log"));
                let server_log = data_dir_for_thread.as_ref().map(|d| d.join("server.log"));
                let combined = format!(
                    "=== logs/asanagi.log（起動処理） ===\n{}\n\n=== server.log（Node サーバ） ===\n{}",
                    app_log
                        .as_deref()
                        .map(|p| read_log_tail(p, 16 * 1024))
                        .unwrap_or_else(|| "(ログの場所を特定できません)".into()),
                    server_log
                        .as_deref()
                        .map(|p| read_log_tail(p, 16 * 1024))
                        .unwrap_or_else(|| "(ログの場所を特定できません)".into()),
                );
                // Embed the log text as a JSON string literal (serde handles all
                // escaping), then set it via textContent to dodge HTML/JS injection.
                let txt = serde_json::to_string(&combined)
                    .unwrap_or_else(|_| "\"(ログを表示できません)\"".into());
                let js = ERROR_PAGE_JS.replace("__LOG_TEXT__", &txt);
                let _ = win.eval(&js);
            }
        }
    });
}

/// The error page shown when the local server never comes up. `__LOG_TEXT__` is
/// replaced with a JSON string of the log tail; the page renders it read-only
/// with a Copy button and points at the Help menu for the log folder.
const ERROR_PAGE_JS: &str = r#"(function(){
  var txt = __LOG_TEXT__;
  document.documentElement.innerHTML =
    '<div style="font-family:system-ui,sans-serif;max-width:52rem;margin:2.5rem auto;padding:0 1.5rem;line-height:1.7;color:#222">'
    + '<h2 style="margin:0 0 .5rem">ローカルサーバを起動できませんでした</h2>'
    + '<p style="margin:.3rem 0">Node ランタイムはアプリに同梱されているため通常インストールは不要です。何度か再起動しても直らない場合は、下のログを開発者にお知らせください。</p>'
    + '<p style="margin:.3rem 0;color:#555">メニューバーの <b>ヘルプ → ログフォルダを開く</b> からも同じログを開けます。</p>'
    + '<div style="display:flex;gap:.5rem;margin:.8rem 0"><button id="asanagi-copy" style="padding:.4rem .9rem;border:1px solid #888;border-radius:.4rem;background:#f5f5f5;cursor:pointer;font-size:.9rem">ログをコピー</button></div>'
    + '<pre id="asanagi-log" style="background:#111;color:#eee;padding:1rem;border-radius:.5rem;max-height:24rem;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:.8rem;line-height:1.5"></pre>'
    + '</div>';
  document.getElementById('asanagi-log').textContent = txt;
  document.getElementById('asanagi-copy').onclick = function(){
    navigator.clipboard.writeText(txt).then(function(){ document.getElementById('asanagi-copy').textContent='コピーしました'; });
  };
})();"#;

/// Native Help menu → open the log folder / individual log files with the OS
/// default app. Native so it works even when the web UI failed to load.
fn install_menu(app: &tauri::App) {
    let build = || -> tauri::Result<()> {
        let open_dir = MenuItemBuilder::with_id("open_log_dir", "ログフォルダを開く").build(app)?;
        let open_app_log =
            MenuItemBuilder::with_id("open_app_log", "アプリログを表示 (asanagi.log)").build(app)?;
        let open_server_log =
            MenuItemBuilder::with_id("open_server_log", "サーバログを表示 (server.log)").build(app)?;
        let help = SubmenuBuilder::new(app, "ヘルプ")
            .items(&[&open_dir, &open_app_log, &open_server_log])
            .build()?;
        let menu = MenuBuilder::new(app).items(&[&help]).build()?;
        app.set_menu(menu)?;
        Ok(())
    };
    if let Err(e) = build() {
        log::error!("install_menu failed: {e}");
        return;
    }
    app.on_menu_event(move |app, event| {
        let log_dir = app.path().app_log_dir().ok();
        let data_dir = app.path().app_data_dir().ok();
        match event.id().as_ref() {
            "open_log_dir" => {
                // Prefer the log dir; fall back to the data dir (server.log lives there).
                if let Some(d) = log_dir.or(data_dir) {
                    open_in_os(&d);
                }
            }
            "open_app_log" => {
                if let Some(d) = log_dir {
                    open_in_os(&d.join("asanagi.log"));
                }
            }
            "open_server_log" => {
                if let Some(d) = data_dir {
                    open_in_os(&d.join("server.log"));
                }
            }
            _ => {}
        }
    });
}

/// tauri-plugin-log configured to also write a file in the app log dir, so a
/// release build's startup diagnostics (node path/version, chosen port, spawn
/// result, server up/timeout) are captured for troubleshooting — not just debug.
fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_log::{Target, TargetKind};
    tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some("asanagi".into()),
            }),
        ])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(log_plugin())
        .setup(|app| {
            // Native Help menu (log access) — available in both dev and release.
            install_menu(app);
            // Release: launch the bundled standalone server. Dev: use devUrl.
            if !cfg!(debug_assertions) {
                start_server(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
