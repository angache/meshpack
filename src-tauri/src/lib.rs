mod compression;
mod config;
mod drive;
mod files;
mod watcher;

use config::{AppConfig, PublicConfig};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, State};

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub watcher: Mutex<Option<watcher::FolderWatcher>>,
}

fn restart_watcher(app: &AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let folder = match &config.watch_folder {
        Some(f) if !f.is_empty() => f.clone(),
        _ => return Ok(()),
    };
    let extensions = config.file_extensions.clone();
    let focus = config.focus_on_new_scan;
    drop(config);

    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
    if let Some(old) = watcher_guard.take() {
        old.stop();
    }
    let new_watcher = watcher::FolderWatcher::start(
        app.clone(),
        folder,
        extensions,
        focus,
    )?;
    *watcher_guard = Some(new_watcher);
    Ok(())
}

fn handle_after_upload(
    file_paths: &[String],
    after_upload: &str,
    archive_folder: Option<&String>,
) -> Result<(), String> {
    match after_upload {
        "delete" => {
            for path in file_paths {
                fs::remove_file(path).map_err(|e| format!("Silinemedi {path}: {e}"))?;
            }
        }
        "archive" => {
            let dest_dir = archive_folder
                .filter(|d| !d.is_empty())
                .ok_or("Arşiv klasörü ayarlanmamış")?;
            fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
            for path in file_paths {
                let source = Path::new(path);
                let name = source
                    .file_name()
                    .ok_or_else(|| format!("Geçersiz dosya: {path}"))?;
                let dest = Path::new(dest_dir).join(name);
                fs::rename(source, &dest).map_err(|e| format!("Taşınamadı {path}: {e}"))?;
            }
        }
        _ => {}
    }
    Ok(())
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
fn save_settings(
    app: AppHandle,
    settings: PublicConfig,
    state: State<'_, AppState>,
) -> Result<PublicConfig, String> {
    {
        let mut config = state.config.lock().map_err(|e| e.to_string())?;
        config.merge_public(settings);
        config.save().map_err(|e| e.to_string())?;
    }
    restart_watcher(&app, &state)?;
    get_config(state)
}

#[tauri::command]
fn list_folder_scans(folder: String, state: State<'_, AppState>) -> Result<Vec<files::ScanFileEntry>, String> {
    let extensions = state
        .config
        .lock()
        .map_err(|e| e.to_string())?
        .file_extensions
        .clone();
    files::list_scan_files(&folder, &extensions)
}

#[tauri::command]
fn start_watching(
    app: AppHandle,
    folder: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut config = state.config.lock().map_err(|e| e.to_string())?;
        config.watch_folder = Some(folder.clone());
        config.save().map_err(|e| e.to_string())?;
    }
    restart_watcher(&app, &state)
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
    let (token, zip_template, after_upload, archive_folder, drive_folder) = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        (
            config
                .drive_token
                .clone()
                .ok_or("Google Drive'a bağlı değilsiniz. Ayarlardan bağlanın.")?,
            config.zip_name_template.clone(),
            config.after_upload.clone(),
            config.archive_folder.clone(),
            config.drive_folder_name.clone(),
        )
    };

    let zip_path = compression::compress_scans(
        &file_paths,
        &patient_name,
        &zip_template,
        alignment.as_ref(),
    )
    .map_err(|e| e.to_string())?;

    let download_link = drive::upload_files(
        &token,
        &zip_path,
        &patient_name,
        &notes,
        &drive_folder,
    )
    .await
    .map_err(|e| e.to_string())?;

    let _ = fs::remove_file(&zip_path);

    handle_after_upload(&file_paths, &after_upload, archive_folder.as_ref())?;

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
            save_settings,
            list_folder_scans,
            start_watching,
            drive_authenticate,
            compress_and_upload,
        ])
        .run(tauri::generate_context!())
        .expect("MeshPack başlatılırken hata oluştu");
}
