// Storq POS desktop shell.
//
// The till itself is the same React app the web build ships; this process adds
// the three things a browser cannot give a shop counter: a durable local
// database, native documents, and one always-open window that starts without a
// network.

mod db;
mod tools;
mod updater;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // Launching the shortcut again must focus the open till, never start a
        // second one: two windows would mean two PIN sessions and two queues.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // A till that cannot open its database still has to open: the web app
            // falls back to its own storage and keeps selling.
            if let Err(error) = db::init(app.handle()) {
                eprintln!("storq: local database unavailable: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::cache_all,
            db::cache_replace,
            db::cache_clear,
            db::outbox_all,
            db::outbox_replace,
            db::db_stats,
            tools::save_file,
            tools::open_external,
            tools::app_info,
            updater::check_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Storq POS");
}
