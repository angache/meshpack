mod activity_log;
mod compression;
mod config;
mod db;
mod drive;
mod files;
mod local_users;
mod pin_auth;
mod secure_storage;
mod stem;
mod watcher;

use config::{AppConfig, PublicConfig};
use activity_log::ActivityLogEntry;
use db::{AuditEntry, Case, Patient, ScanLink, SentCaseRow, StemAlias, StemRejection};
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
    manifest: Option<String>,
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
        Some(notes.as_str()),
        manifest.as_deref(),
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

#[tauri::command]
fn export_case_zip(
    file_paths: Vec<String>,
    patient_name: String,
    summary: String,
    manifest: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if file_paths.is_empty() {
        return Err("Dışa aktarılacak dosya yok".to_string());
    }

    let zip_template = state
        .config
        .lock()
        .map_err(|e| e.to_string())?
        .zip_name_template
        .clone();

    let zip_path = compression::export_scans_zip(
        &file_paths,
        &patient_name,
        &zip_template,
        Some(summary.as_str()),
        manifest.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    Ok(zip_path.to_string_lossy().to_string())
}

#[tauri::command]
fn reveal_path_in_folder(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("Dosya bulunamadı".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        open::that(path.parent().unwrap_or(path))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
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
    tooth_shade: String,
    dental_plan: String,
    annotations: String,
    state: State<'_, AppState>,
) -> Result<Case, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_case_planning(&conn, &case_id, &lab_notes, &tooth_shade, &dental_plan, &annotations)
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
fn begin_case_planning(case_id: String, state: State<'_, AppState>) -> Result<Case, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::begin_case_planning(&conn, &case_id)
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
fn list_stem_aliases(state: State<'_, AppState>) -> Result<Vec<StemAlias>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_stem_aliases(&conn)
}

#[tauri::command]
fn list_patient_scans(patient_id: String, state: State<'_, AppState>) -> Result<Vec<ScanLink>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_patient_scans(&conn, &patient_id)
}

#[tauri::command]
fn list_audit_log(
    limit: Option<i64>,
    patient_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<AuditEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_audit_log(&conn, limit.unwrap_or(100), patient_id.as_deref())
}

#[tauri::command]
fn list_sent_cases(limit: Option<i64>, state: State<'_, AppState>) -> Result<Vec<SentCaseRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_sent_cases(&conn, limit.unwrap_or(50))
}

#[tauri::command]
fn list_stem_rejections(state: State<'_, AppState>) -> Result<Vec<StemRejection>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_stem_rejections(&conn)
}

#[tauri::command]
fn reject_stem_suggestion(
    file_stem: String,
    patient_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::reject_stem_suggestion(&conn, &file_stem, &patient_id)
}

#[tauri::command]
fn backup_database() -> Result<String, String> {
    let path = db::backup_database_default()?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_database(dest_path: String) -> Result<String, String> {
    db::export_database_copy(Path::new(&dest_path))?;
    Ok(dest_path)
}

#[tauri::command]
fn secure_storage_get(key: String) -> Result<Option<String>, String> {
    secure_storage::secure_get(&key)
}

#[tauri::command]
fn secure_storage_set(key: String, value: String) -> Result<(), String> {
    secure_storage::secure_set(&key, &value)
}

#[tauri::command]
fn secure_storage_remove(key: String) -> Result<(), String> {
    secure_storage::secure_remove(&key)
}

#[tauri::command]
fn secure_storage_clear_cloud() -> Result<usize, String> {
    secure_storage::secure_clear_prefix("sb-")
}

#[tauri::command]
fn local_auth_status(state: State<'_, AppState>) -> Result<local_users::LocalAuthStatus, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    local_users::status(&conn)
}

#[tauri::command]
fn list_local_users(state: State<'_, AppState>) -> Result<Vec<local_users::LocalUserPublic>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    local_users::list_users(&conn)
}

#[tauri::command]
fn local_auth_setup_first_user(
    display_name: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<local_users::LocalSession, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let session = local_users::setup_first_user(&conn, &display_name, &pin)?;
    activity_log::write(
        &conn,
        "auth",
        "setup",
        &format!("İlk hesap oluşturuldu: {}", session.display_name),
        Some(&session.role),
        None,
        None,
    )
    .ok();
    Ok(session)
}

#[tauri::command]
fn local_auth_login(
    user_id: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let ok = local_users::login(&conn, &user_id, &pin)?;
    if ok {
        if let Some(user) = local_users::current_session() {
            activity_log::write(
                &conn,
                "auth",
                "login",
                &format!("{} giriş yaptı", user.display_name),
                Some(&user.role),
                None,
                None,
            )
            .ok();
        }
    }
    Ok(ok)
}

#[tauri::command]
fn local_auth_lock(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(user) = local_users::current_session() {
        if let Ok(conn) = state.db.lock() {
            activity_log::write(
                &conn,
                "auth",
                "lock",
                &format!("{} oturumu kapattı", user.display_name),
                None,
                None,
                None,
            )
            .ok();
        }
    }
    local_users::lock();
    Ok(())
}

#[tauri::command]
fn local_auth_change_pin(
    user_id: String,
    current_pin: String,
    new_pin: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    local_users::change_pin(&conn, &user_id, &current_pin, &new_pin)
}

#[tauri::command]
fn create_local_user(
    display_name: String,
    pin: String,
    role: String,
    state: State<'_, AppState>,
) -> Result<local_users::LocalUserPublic, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let user = local_users::create_user(&conn, &display_name, &pin, &role)?;
    activity_log::write(
        &conn,
        "user",
        "create",
        &format!(
            "Kullanıcı eklendi: {} ({})",
            user.display_name,
            if user.role == "doctor" { "Doktor" } else { "Asistan" }
        ),
        None,
        None,
        None,
    )
    .ok();
    Ok(user)
}

#[tauri::command]
fn list_activity_log(
    limit: Option<i64>,
    category: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ActivityLogEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activity_log::list(&conn, limit.unwrap_or(150), category.as_deref())
}

#[tauri::command]
fn log_activity(
    category: String,
    action: String,
    summary: String,
    details: Option<String>,
    patient_id: Option<String>,
    case_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    activity_log::write(
        &conn,
        &category,
        &action,
        &summary,
        details.as_deref(),
        patient_id.as_deref(),
        case_id.as_deref(),
    )
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
            export_case_zip,
            reveal_path_in_folder,
            read_file_bytes,
            list_patients,
            create_patient,
            update_patient,
            delete_patient,
            list_scan_links,
            list_stem_aliases,
            list_patient_scans,
            list_audit_log,
            list_sent_cases,
            list_stem_rejections,
            reject_stem_suggestion,
            backup_database,
            export_database,
            secure_storage_get,
            secure_storage_set,
            secure_storage_remove,
            secure_storage_clear_cloud,
            local_auth_status,
            list_local_users,
            local_auth_setup_first_user,
            local_auth_login,
            local_auth_lock,
            local_auth_change_pin,
            create_local_user,
            list_activity_log,
            log_activity,
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
            begin_case_planning,
            update_case_status,
        ])
        .run(tauri::generate_context!())
        .expect("MeshPack başlatılırken hata oluştu");
}
