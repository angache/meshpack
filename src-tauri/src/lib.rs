mod compression;
mod config;
mod db;
mod drive;
mod files;
mod watcher;

use config::{AppConfig, PublicConfig};
use db::{Case, Patient, ScanLink};
use rusqlite::Connection;
use serde::Deserialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, State};

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub watcher: Mutex<Option<watcher::FolderWatcher>>,
    pub db: Mutex<Connection>,
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

#[derive(Debug, Deserialize)]
struct ScanFileInput {
    path: String,
    filename: String,
    file_stem: String,
    scan_type: String,
    modified_at: i64,
}

#[tauri::command]
fn create_case(
    patient_id: String,
    session_day: String,
    state: State<'_, AppState>,
) -> Result<Case, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_case(&conn, &patient_id, &session_day)
}

#[tauri::command]
fn find_case_for_day(
    patient_id: String,
    session_day: String,
    state: State<'_, AppState>,
) -> Result<Option<Case>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::find_case_for_day(&conn, &patient_id, &session_day)
}

#[tauri::command]
fn list_patient_cases(patient_id: String, state: State<'_, AppState>) -> Result<Vec<Case>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_patient_cases(&conn, &patient_id)
}

#[tauri::command]
fn list_case_scans(case_id: String, state: State<'_, AppState>) -> Result<Vec<ScanLink>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_case_scans(&conn, &case_id)
}

#[tauri::command]
fn link_scans_to_case(
    patient_id: String,
    case_id: String,
    files: Vec<ScanFileInput>,
    state: State<'_, AppState>,
) -> Result<Vec<ScanLink>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut linked = Vec::new();
    for f in files {
        let link = db::link_scan(
            &conn,
            &patient_id,
            &case_id,
            &f.path,
            &f.filename,
            &f.file_stem,
            &f.scan_type,
            f.modified_at,
        )?;
        linked.push(link);
    }
    Ok(linked)
}

#[tauri::command]
fn reassign_scan(
    file_path: String,
    to_patient_id: String,
    to_case_id: String,
    reason: String,
    state: State<'_, AppState>,
) -> Result<ScanLink, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::reassign_scan(&conn, &file_path, &to_patient_id, &to_case_id, &reason)
}

#[tauri::command]
fn detach_scan(file_path: String, reason: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::detach_scan(&conn, &file_path, &reason)
}

#[tauri::command]
fn get_case(case_id: String, state: State<'_, AppState>) -> Result<Case, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_case(&conn, &case_id)?.ok_or_else(|| "Vaka bulunamadı".to_string())
}

#[tauri::command]
fn update_case_planning(
    case_id: String,
    lab_notes: String,
    dental_plan: String,
    annotations: String,
    state: State<'_, AppState>,
) -> Result<Case, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_case_planning(&conn, &case_id, &lab_notes, &dental_plan, &annotations)
}

#[tauri::command]
fn update_case_lab_notes(
    case_id: String,
    lab_notes: String,
    state: State<'_, AppState>,
) -> Result<Case, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_case_lab_notes(&conn, &case_id, &lab_notes)
}

#[tauri::command]
fn update_case_status(
    case_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Case, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_case_status(&conn, &case_id, &status)
}

#[tauri::command]
fn list_patients(state: State<'_, AppState>) -> Result<Vec<Patient>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_patients(&conn)
}

#[tauri::command]
fn create_patient(
    surname: String,
    first_name: String,
    notes: String,
    state: State<'_, AppState>,
) -> Result<Patient, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_patient(&conn, &surname, &first_name, &notes)
}

#[tauri::command]
fn update_patient(
    id: String,
    surname: String,
    first_name: String,
    notes: String,
    state: State<'_, AppState>,
) -> Result<Patient, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_patient(&conn, &id, &surname, &first_name, &notes)
}

#[tauri::command]
fn delete_patient(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_patient(&conn, &id)
}

#[tauri::command]
fn list_scan_links(state: State<'_, AppState>) -> Result<Vec<ScanLink>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_scan_links(&conn)
}

#[tauri::command]
fn list_patient_scans(patient_id: String, state: State<'_, AppState>) -> Result<Vec<ScanLink>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_patient_scans(&conn, &patient_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let config = AppConfig::load().unwrap_or_default();
    let db_conn = db::open().expect("Veritabanı açılamadı");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            config: Mutex::new(config),
            watcher: Mutex::new(None),
            db: Mutex::new(db_conn),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_settings,
            list_folder_scans,
            start_watching,
            drive_authenticate,
            compress_and_upload,
            list_patients,
            create_patient,
            update_patient,
            delete_patient,
            list_scan_links,
            list_patient_scans,
            create_case,
            find_case_for_day,
            list_patient_cases,
            list_case_scans,
            link_scans_to_case,
            reassign_scan,
            detach_scan,
            get_case,
            update_case_lab_notes,
            update_case_planning,
            update_case_status,
        ])
        .run(tauri::generate_context!())
        .expect("MeshPack başlatılırken hata oluştu");
}
