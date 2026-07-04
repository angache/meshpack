mod compression;
mod config;
mod drive;
mod files;
mod watcher;

use config::{AppConfig, PublicConfig};
use std::sync::Mutex;
use tauri::{AppHandle, State};

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub watcher: Mutex<Option<watcher::FolderWatcher>>,
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> Result<PublicConfig, String> {
    state
        .config
        .lock()
        .map_err(|e| e.to_string())
        .map(|c| PublicConfig::from(c.clone()))
}

#[tauri::command]
fn list_folder_scans(folder: String) -> Result<Vec<files::ScanFileEntry>, String> {
    files::list_scan_files(&folder)
}

#[tauri::command]
fn start_watching(
    app: AppHandle,
    folder: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.watch_folder = Some(folder.clone());
    config.save().map_err(|e| e.to_string())?;

    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
    if let Some(old) = watcher_guard.take() {
        old.stop();
    }

    let new_watcher = watcher::FolderWatcher::start(app.clone(), folder)?;
    *watcher_guard = Some(new_watcher);

    Ok(())
}

#[tauri::command]
async fn drive_authenticate(state: State<'_, AppState>) -> Result<bool, String> {
    let token = drive::authenticate().await.map_err(|e| e.to_string())?;

    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.drive_token = Some(token);
    config.drive_connected = true;
    config.save().map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
async fn compress_and_upload(
    file_paths: Vec<String>,
    patient_name: String,
    notes: String,
    alignment: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let token = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        config
            .drive_token
            .clone()
            .ok_or("Google Drive'a bağlı değilsiniz. Ayarlardan bağlanın.")?
    };

    let zip_path = compression::compress_scans(&file_paths, &patient_name, alignment.as_ref())
        .map_err(|e| e.to_string())?;

    let download_link = drive::upload_files(&token, &zip_path, &patient_name, &notes)
        .await
        .map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&zip_path);

    Ok(download_link)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let config = AppConfig::load().unwrap_or_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            config: Mutex::new(config),
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            list_folder_scans,
            start_watching,
            drive_authenticate,
            compress_and_upload,
        ])
        .run(tauri::generate_context!())
        .expect("MeshPack başlatılırken hata oluştu");
}
