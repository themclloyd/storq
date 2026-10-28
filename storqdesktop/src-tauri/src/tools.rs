// Native bits the browser cannot do: a real "Save as" dialog for the documents
// the till generates, and handing external links to the system browser instead
// of opening them inside the till window.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::io::Write as _;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// 64 MiB is far above any till document (a year of receipts is a few MB) and
/// well below the point where holding the file in memory hurts.
const MAX_BYTES: usize = 64 * 1024 * 1024;

fn extension(name: &str) -> Option<String> {
    name.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .filter(|ext| ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// Keep only the file name: a caller must never be able to aim the dialog at a
/// path outside the folder the operator picks.
fn file_name(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("storq-document")
        .trim();
    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\u{0}'..='\u{1f}'))
        .collect();
    if cleaned.is_empty() {
        "storq-document".into()
    } else {
        cleaned
    }
}

/// Write a document the web app generated (PDF, CSV, receipt text) wherever the
/// operator points the native save dialog. `data` is base64 so binary PDFs
/// survive the IPC bridge untouched. Returns the saved path, or `None` when the
/// dialog was dismissed.
#[tauri::command]
pub async fn save_file<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    data: String,
) -> Result<Option<String>, String> {
    let name = file_name(&name);
    let bytes = BASE64
        .decode(data.as_bytes())
        .map_err(|e| format!("invalid file payload: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("document is too large to save".into());
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let builder = app.dialog().file().set_file_name(&name);
    let builder = match extension(&name).as_deref() {
        Some("pdf") => builder.add_filter("PDF", &["pdf"]),
        Some("csv") => builder.add_filter("Spreadsheet", &["csv"]),
        Some("txt") => builder.add_filter("Text", &["txt"]),
        _ => builder,
    };
    builder.save_file(move |picked| {
        let _ = tx.send(picked);
    });

    // The dialog resolves on the main thread; wait for it off the runtime so a
    // slow operator never parks an async worker.
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(&path).map_err(|e| format!("could not create file: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("could not write file: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Hand a link to the system browser. Only http(s) and mailto leave the app:
/// the webview must never be able to launch an arbitrary local handler.
#[tauri::command]
pub fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    let target = url.trim();
    let allowed = target.starts_with("https://")
        || target.starts_with("http://")
        || target.starts_with("mailto:");
    if !allowed || target.contains(['"', '\n', '\r', '\u{0}']) {
        return Err("only web links can be opened outside the till".into());
    }
    app.opener()
        .open_url(target.to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
    pub platform: String,
    pub data_dir: Option<String>,
}

/// What this install is, for the About card and the update banner.
#[tauri::command]
pub fn app_info<R: Runtime>(app: AppHandle<R>) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        identifier: app.config().identifier.clone(),
        platform: std::env::consts::OS.to_string(),
        data_dir: app
            .path()
            .app_data_dir()
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
    }
}
