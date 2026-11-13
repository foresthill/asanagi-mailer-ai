use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Manager;

/// Buffers incoming `mailto:` URLs until the webview has loaded. On a cold start
/// (the app is launched BY a mailto click) the deep-link event fires before the
/// bundled Node server is up and the window has navigated, so we queue the URL
/// and flush it once the UI is ready. Managed as Tauri state.
#[derive(Default)]
struct MailtoQueue {
    ready: AtomicBool,
    pending: Mutex<Vec<String>>,
}

/// JS injected into the web UI to hand it a mailto URL. Sets a global (read on
/// mount — covers the listener-not-yet-mounted case) AND dispatches an event
/// (covers the app-already-running case). The web side parses it into a compose
/// tab (see src/components/mail/MailApp.tsx). The URL is serde-escaped, so it
/// cannot break out of the string literal.
const MAILTO_JS: &str = r#"(function(){
  var url = __URL__;
  try { window.__ASANAGI_PENDING_MAILTO__ = url; } catch(e){}
  try { window.dispatchEvent(new CustomEvent('asanagi:mailto', { detail: url })); } catch(e){}
})();"#;

/// Deliver a mailto URL to the web UI, or queue it if the UI isn't ready yet.
/// Only `mailto:` is accepted (other deep links are ignored).
fn deliver_mailto(handle: &tauri::AppHandle, url: String) {
    if !url.trim_start().to_ascii_lowercase().starts_with("mailto:") {
        return;
    }
    let state = handle.state::<MailtoQueue>();
    if state.ready.load(Ordering::SeqCst) {
        eval_mailto(handle, &url);
    } else if let Ok(mut q) = state.pending.lock() {
        log::info!("mailto queued (UI not ready yet)");
        q.push(url);
    }
}

/// Inject one mailto URL into the loaded web UI via `win.eval`.
fn eval_mailto(handle: &tauri::AppHandle, url: &str) {
    match handle.get_webview_window("main") {
        Some(win) => {
            let json = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".into());
            let js = MAILTO_JS.replace("__URL__", &json);
            let _ = win.eval(&js);
            log::info!("mailto delivered to web UI");
        }
        None => log::warn!("mailto: no main window to deliver to"),
    }
}

/// Mark the UI ready and flush any mailto URLs that arrived during startup.
fn flush_mailto(handle: &tauri::AppHandle) {
    let state = handle.state::<MailtoQueue>();
    state.ready.store(true, Ordering::SeqCst);
    // Drain into an owned Vec so the mutex guard is released before we eval
    // (which reborrows `handle`), avoiding holding the lock across delivery.
    let urls: Vec<String> = match state.pending.lock() {
        Ok(mut q) => q.drain(..).collect(),
        Err(_) => return,
    };
    for u in urls {
        eval_mailto(handle, &u);
    }
}

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

/// Bundled Node binary name (Windows needs the .exe extension to be executable).
#[cfg(windows)]
const NODE_BIN: &str = "node.exe";
#[cfg(not(windows))]
const NODE_BIN: &str = "node";
/// Name of the writable copy in the app-data dir.
#[cfg(windows)]
const RUNTIME_NODE: &str = "runtime-node.exe";
#[cfg(not(windows))]
const RUNTIME_NODE: &str = "runtime-node";

/// Resolve a runnable Node: the bundled binary lives in the (possibly read-only)
/// resource dir, so copy it once into the writable app-data dir and set +x.
/// Returns the resource copy as a fallback if no writable dir is available.
fn ensure_node(resource_dir: &Path, data_dir: Option<&Path>) -> PathBuf {
    let bundled = resource_dir.join(NODE_BIN);
    let Some(d) = data_dir else { return bundled };
    let dest = d.join(RUNTIME_NODE);
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

/// On Windows the app binary is a GUI ("windows") subsystem process with no
/// console (see main.rs), so spawning a console-subsystem child (node.exe) makes
/// Windows allocate and show a new console window — the stray "next-server" window
/// users were seeing. CREATE_NO_WINDOW suppresses it. No-op on macOS/Linux.
fn hide_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Does this `node` binary actually run here? Runs `node --version` and logs the
/// result — turns a silent "server never started" into a diagnosable line
/// (e.g. a GLIBC/arch error on stderr) in the app log.
fn node_works(bin: &Path) -> bool {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg("--version");
    hide_console(&mut cmd); // don't flash a console window on Windows
    match cmd.output() {
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
    let mut cands: Vec<PathBuf> = vec![PathBuf::from(NODE_BIN)]; // PATH lookup
    #[cfg(not(windows))]
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

    // Windows: suppress the console window the spawned node.exe would otherwise
    // pop up (the app itself is a GUI subsystem with no console to inherit).
    hide_console(&mut cmd);

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
                // Navigate to 127.0.0.1, NOT "localhost": the Next server binds
                // HOSTNAME=127.0.0.1 (IPv4) and the readiness probe above also
                // hits 127.0.0.1, but on many Linux boxes "localhost" resolves to
                // IPv6 ::1 first — where nothing listens — so a localhost load
                // fails with a webview connection error ("通信エラー") even though
                // the server is up. Matching the bound host removes that mismatch.
                log::info!("server up on {port}; navigating window to 127.0.0.1");
                match format!("http://127.0.0.1:{port}").parse() {
                    Ok(url) => {
                        let _ = win.navigate(url);
                    }
                    Err(e) => log::error!("bad server url: {e}"),
                }
                // UI is loading — release any mailto URL received during startup
                // (cold start where the app was launched by a mailto click).
                flush_mailto(&handle);
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

/// Show a transient toast in the loaded web UI. Used by the manual "check for
/// update" flow so the user gets feedback (checking / up-to-date / downloaded)
/// without adding a dialog-plugin dependency. The message is injected via
/// textContent (serde-escaped), so it can't break out into HTML/JS.
fn notify_web(handle: &tauri::AppHandle, msg: &str) {
    let Some(win) = handle.get_webview_window("main") else {
        return;
    };
    let txt = serde_json::to_string(msg).unwrap_or_else(|_| "\"\"".into());
    let js = TOAST_JS.replace("__MSG__", &txt);
    let _ = win.eval(&js);
}

/// Toast element injected by `notify_web`. Reuses a single element so repeated
/// calls (checking → downloading → done) replace the text rather than stack.
const TOAST_JS: &str = r#"(function(){
  var msg = __MSG__;
  var id = 'asanagi-toast';
  var el = document.getElementById(id);
  if(!el){
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:90vw;padding:.7rem 1.1rem;border-radius:.6rem;background:rgba(20,20,20,.92);color:#fff;font:14px/1.5 system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);white-space:pre-wrap;word-break:break-word';
    (document.body||document.documentElement).appendChild(el);
  }
  el.textContent = msg;
  if(el._t) clearTimeout(el._t);
  el._t = setTimeout(function(){ if(el&&el.parentNode) el.parentNode.removeChild(el); }, 9000);
})();"#;

/// Native OS dialog for update *results* — unlike `notify_web` (a toast injected
/// into the web UI), this is visible even when the web UI failed to load (the
/// exact case the user hit while updating FROM a broken build). Non-blocking.
fn notify_native(handle: &tauri::AppHandle, title: &str, msg: &str) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    handle
        .dialog()
        .message(msg.to_string())
        .title(title.to_string())
        .kind(MessageDialogKind::Info)
        .show(|_| {});
}

/// After a manual update finishes downloading, offer「再起動」/「あとで」instead of
/// telling the user to quit and reopen. 「再起動」relaunches the app so the staged
/// update applies immediately (Tauri `AppHandle::restart` re-resolves the bundle on
/// macOS); 「あとで」leaves it to apply on the next normal launch. Non-blocking.
fn prompt_restart(handle: tauri::AppHandle, newv: String) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let msg =
        format!("バージョン {newv} をダウンロードしました。\n今すぐ再起動して適用しますか？");
    let h = handle.clone();
    handle
        .dialog()
        .message(msg)
        .title("アップデート完了")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "再起動".to_string(),
            "あとで".to_string(),
        ))
        .show(move |restart| {
            if restart {
                log::info!("manual update: restarting to apply");
                h.restart();
            } else {
                log::info!("manual update: apply deferred to next launch");
                notify_web(&h, "次回アプリを起動したときに適用されます。");
            }
        });
}

/// Manual update check from the Help menu. Reports progress via `notify_web`.
/// Unlike the silent startup check, this always tells the user the result —
/// including "already up to date" — because they explicitly asked.
async fn check_update_interactive(handle: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    notify_web(&handle, "アップデートを確認しています…");
    let updater = match handle.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("updater unavailable: {e}");
            notify_web(&handle, "アップデート機能を利用できません。");
            notify_native(&handle, "アップデート", "アップデート機能を利用できません。");
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            let newv = update.version.clone();
            let curv = update.current_version.clone();
            log::info!("manual check: update {curv} -> {newv}");
            // Show current vs latest and let the user confirm before downloading.
            // Non-blocking: the dialog's callback drives the download, so this
            // async fn returns while the dialog is open.
            confirm_and_install(handle.clone(), update, curv, newv);
        }
        Ok(None) => {
            let cur = handle.package_info().version.to_string();
            log::info!("manual check: up to date (v{cur})");
            let m = format!("最新版です（v{cur}）。");
            notify_web(&handle, &m);
            notify_native(&handle, "アップデート", &m);
        }
        Err(e) => {
            log::warn!("manual update check failed: {e}");
            let m = "更新を確認できませんでした（オフラインの可能性があります）。";
            notify_web(&handle, m);
            notify_native(&handle, "アップデート", m);
        }
    }
}

/// Confirmation step for the manual update flow: show the current and latest
/// versions with an「アップデート」/「あとで」choice, and only download when the
/// user confirms. The native dialog is non-blocking — its `FnOnce(bool)`
/// callback (true = user pressed「アップデート」) spawns the download, which is
/// staged and applied on the next launch.
fn confirm_and_install(
    handle: tauri::AppHandle,
    update: tauri_plugin_updater::Update,
    cur: String,
    new: String,
) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let msg = format!(
        "現在のバージョン: v{cur}\n最新のバージョン: v{new}\n\nアップデートしますか？\n（ダウンロード後に再起動で適用できます）"
    );
    let h = handle.clone();
    handle
        .dialog()
        .message(msg)
        .title("アップデートがあります")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "アップデート".to_string(),
            "あとで".to_string(),
        ))
        .show(move |ok| {
            if !ok {
                log::info!("manual update: user chose 'later'");
                notify_web(&h, "アップデートをキャンセルしました。");
                return;
            }
            let h2 = h.clone();
            let newv = new.clone();
            tauri::async_runtime::spawn(async move {
                notify_web(
                    &h2,
                    &format!("新しいバージョン {newv} をダウンロードしています…"),
                );
                match update.download_and_install(|_chunk, _total| {}, || {}).await {
                    Ok(_) => {
                        log::info!("manual update installed; prompting restart");
                        notify_web(
                            &h2,
                            &format!("バージョン {newv} をダウンロードしました。"),
                        );
                        // 「開き直してください」ではなく、再起動ボタンで即適用できるようにする。
                        prompt_restart(h2.clone(), newv.clone());
                    }
                    Err(e) => {
                        log::warn!("manual update install failed: {e}");
                        let m = "更新のダウンロードに失敗しました。時間をおいて再度お試しください。";
                        notify_web(&h2, m);
                        notify_native(&h2, "アップデート", m);
                    }
                }
            });
        });
}

/// Native Help menu → open the log folder / individual log files with the OS
/// default app, plus manual update-check and quit. Native so it works even when
/// the web UI failed to load (update-check feedback needs the UI, though).
fn install_menu(app: &tauri::App) {
    let build = || -> tauri::Result<()> {
        let open_dir = MenuItemBuilder::with_id("open_log_dir", "ログフォルダを開く").build(app)?;
        let open_app_log =
            MenuItemBuilder::with_id("open_app_log", "アプリログを表示 (asanagi.log)").build(app)?;
        let open_server_log =
            MenuItemBuilder::with_id("open_server_log", "サーバログを表示 (server.log)").build(app)?;
        let check_update =
            MenuItemBuilder::with_id("check_update", "アップデートを確認…").build(app)?;

        // アプリメニュー（macOS は先頭サブメニュー＝アプリ名のメニュー）。
        // 「アップデートを確認…」は macOS 慣習に合わせ About の近く（アプリメニュー）に置く。
        let app_menu = SubmenuBuilder::new(app, &app.package_info().name)
            .items(&[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &check_update,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, Some("終了する"))?,
            ])
            .build()?;
        // ファイル（ウィンドウを閉じる。終了はアプリメニューの慣習に合わせ移動）。
        let file = SubmenuBuilder::new(app, "ファイル")
            .items(&[&PredefinedMenuItem::close_window(app, Some("ウィンドウを閉じる"))?])
            .build()?;
        // 編集: これが無いと macOS の WebView で ⌘C/⌘V/⌘X/⌘A が効かない（ペースト
        // できない不具合の原因）。Predefined ロールで OS 標準の挙動になる。
        let edit = SubmenuBuilder::new(app, "編集")
            .items(&[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ])
            .build()?;
        // 表示
        let view = SubmenuBuilder::new(app, "表示")
            .items(&[&PredefinedMenuItem::fullscreen(app, None)?])
            .build()?;
        // ウィンドウ
        let window = SubmenuBuilder::new(app, "ウィンドウ")
            .items(&[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
            ])
            .build()?;
        let help = SubmenuBuilder::new(app, "ヘルプ")
            .items(&[&open_dir, &open_app_log, &open_server_log])
            .build()?;
        let menu = MenuBuilder::new(app)
            .items(&[&app_menu, &file, &edit, &view, &window, &help])
            .build()?;
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
            "check_update" => {
                tauri::async_runtime::spawn(check_update_interactive(app.clone()));
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

/// Check for a newer release and, if found, download+install it in the
/// background. We do NOT force a restart (the user is reading mail): the new
/// bundle is staged and takes effect on the next launch. Non-technical users
/// get updates automatically just by reopening the app. Failures (offline, no
/// latest.json yet, signature mismatch) are logged, never fatal.
/// Note: this covers macOS (.app) and Linux AppImage. .deb/.rpm are managed by
/// the system package manager and are not auto-updated here.
async fn check_for_update(handle: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    let updater = match handle.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("updater unavailable: {e}");
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            log::info!(
                "update available: {} -> {} (downloading in background)",
                update.current_version,
                update.version
            );
            match update.download_and_install(|_chunk, _total| {}, || {}).await {
                Ok(_) => log::info!("update installed; applies on next launch"),
                Err(e) => log::warn!("update install failed: {e}"),
            }
        }
        Ok(None) => log::info!("no update available (up to date)"),
        Err(e) => log::warn!("update check failed: {e}"),
    }
}

/// Save attachment bytes to a user-chosen path via the native Save dialog.
/// Needed because the desktop WebView (WKWebView) ignores blob `<a download>`
/// clicks unless a download handler is registered, so AttachmentList's browser
/// save path silently no-ops in the app. The web UI fetches the bytes
/// (local-first: never cached) and hands them here; we seed a Save dialog with
/// the filename and write the file. Returns true if saved, false if cancelled.
#[tauri::command]
async fn save_file_dialog(
    app: tauri::AppHandle,
    filename: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    // blocking_* is safe here: async commands run off the main thread.
    let picked = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .blocking_save_file();
    match picked {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Save attachment bytes directly into a folder (no dialog) — used when the user
/// turned off "ask every time". `dir` empty = the OS Downloads folder. Avoids
/// clobbering: if the name exists, append " (1)", " (2)", … Returns the path.
#[tauri::command]
async fn save_file_to_dir(
    app: tauri::AppHandle,
    dir: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    use tauri::Manager;
    let base = if dir.trim().is_empty() {
        app.path().download_dir().map_err(|e| e.to_string())?
    } else {
        std::path::PathBuf::from(dir)
    };
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let target = unique_path(&base, &filename);
    std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

/// Pick a folder (for the "default save location" setting). None = cancelled.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_folder();
    match picked {
        Some(fp) => Ok(Some(
            fp.into_path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned(),
        )),
        None => Ok(None),
    }
}

/// A non-clobbering path inside `base` for `filename`: "doc.pdf" → "doc (1).pdf".
fn unique_path(base: &std::path::Path, filename: &str) -> std::path::PathBuf {
    let first = base.join(filename);
    if !first.exists() {
        return first;
    }
    let p = std::path::Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(filename);
    let ext = p.extension().and_then(|s| s.to_str());
    for n in 1..10_000 {
        let name = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let cand = base.join(name);
        if !cand.exists() {
            return cand;
        }
    }
    first
}

/// Open an external http(s) URL in the OS default browser. The desktop WebView
/// does not open `target="_blank"` / external links itself (they silently do
/// nothing), so the frontend intercepts external-link clicks and routes them
/// here. Only http/https are allowed (no file://, javascript:, custom schemes).
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err("unsupported url scheme".into());
    }
    #[cfg(target_os = "linux")]
    let prog = "xdg-open";
    #[cfg(target_os = "macos")]
    let prog = "open";
    #[cfg(target_os = "windows")]
    let prog = "explorer";
    std::process::Command::new(prog)
        .arg(u)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_deep_link::DeepLinkExt;
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(log_plugin())
        .invoke_handler(tauri::generate_handler![
            save_file_dialog,
            save_file_to_dir,
            pick_folder,
            open_external
        ])
        .manage(MailtoQueue::default())
        .setup(|app| {
            // Native Help menu (log access) — available in both dev and release.
            install_menu(app);
            // mailto: handler — the OS opens a `mailto:` URL (e.g. from "open in
            // email") and the deep-link plugin hands it here; forward to the web UI
            // (queued until the UI is ready; see deliver_mailto/flush_mailto).
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for u in event.urls() {
                    deliver_mailto(&handle, u.to_string());
                }
            });
            // Cold start: the launch URL may already be available.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for u in urls {
                    deliver_mailto(app.handle(), u.to_string());
                }
            }
            // Release: launch the bundled standalone server. Dev: use devUrl.
            if !cfg!(debug_assertions) {
                start_server(app.handle());
                // 起動時にバックグラウンドで更新確認（再起動は強制しない＝次回起動で適用）。
                let h = app.handle().clone();
                tauri::async_runtime::spawn(check_for_update(h));
            } else {
                // Dev loads devUrl immediately, so the mailto queue is ready now.
                app.state::<MailtoQueue>().ready.store(true, Ordering::SeqCst);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
