// Auto-update, driven from Rust so the frontend needs no plugin JavaScript:
// the shell calls `check_update` once after the till is unlocked, shows the
// version it gets back, and calls `install_update` when the operator accepts.

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
}

/// `Ok(None)` means this install is current, or the updater was not configured
/// in this build (no endpoints / no public key). Either way the shell stays quiet.
#[tauri::command]
pub async fn check_update<R: Runtime>(app: AppHandle<R>) -> Result<Option<UpdateInfo>, String> {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(_) => return Ok(None),
    };
    let found = updater.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
    }))
}

/// Download, verify the minisign signature and install, then relaunch into the
/// new build. The signature is the only thing that makes this safe: an updater
/// endpoint that is merely reachable (our public storage bucket is) cannot push
/// code the private key did not sign.
#[tauri::command]
pub async fn install_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}
