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

    let mut cmd = std::process::Command::new("node");
    cmd.arg(&server_js)
        .env("PORT", SERVER_PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .current_dir(&server_root);

    // .data（トークン・SQLite・設定）は設置先(読み取り専用のことがある)ではなく
    // OSのユーザーアプリデータ領域へ書く。Nodeサーバは ASANAGI_DATA_DIR を尊重する。
    if let Ok(data_dir) = handle.path().app_data_dir() {
        if let Err(e) = std::fs::create_dir_all(&data_dir) {
            log::warn!("could not create data dir {}: {e}", data_dir.display());
        }
        cmd.env("ASANAGI_DATA_DIR", &data_dir);
        log::info!("ASANAGI_DATA_DIR = {}", data_dir.display());
    }

    match cmd.spawn() {
        Ok(_) => log::info!("started standalone server: {}", server_js.display()),
        Err(e) => log::error!("failed to start server ({}): {e}", server_js.display()),
    }

    let handle = handle.clone();
    std::thread::spawn(move || {
        // Wait (up to ~15s) for the server to accept connections, then load it.
        for _ in 0..60 {
            if std::net::TcpStream::connect(("127.0.0.1", SERVER_PORT)).is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        if let Some(win) = handle.get_webview_window("main") {
            match format!("http://localhost:{SERVER_PORT}").parse() {
                Ok(url) => {
                    let _ = win.navigate(url);
                }
                Err(e) => log::error!("bad server url: {e}"),
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
