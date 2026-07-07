use crate::pin_auth::{hash_pin, verify_pin_hash};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct LocalUserPublic {
    pub id: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Debug, Clone)]
struct LocalUserRow {
    id: String,
    display_name: String,
    role: String,
    pin_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalSession {
    pub user_id: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct LocalAuthStatus {
    pub configured: bool,
    pub logged_in: bool,
    pub user: Option<LocalSession>,
}

static SESSION: Mutex<Option<LocalSession>> = Mutex::new(None);

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn legacy_lock_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("meshpack")
        .join("secure")
        .join("lock.json")
}

#[derive(serde::Deserialize)]
struct LegacyLockConfig {
    pin_hash: String,
}

pub fn migrate_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS local_users (
            id TEXT PRIMARY KEY NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'assistant',
            pin_hash TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    if !crate::db::table_has_column(conn, "audit_log", "user_id")? {
        conn.execute("ALTER TABLE audit_log ADD COLUMN user_id TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    if !crate::db::table_has_column(conn, "audit_log", "user_name")? {
        conn.execute("ALTER TABLE audit_log ADD COLUMN user_name TEXT", [])
            .map_err(|e| e.to_string())?;
    }

    migrate_legacy_device_lock(conn)?;
    migrate_legacy_roles(conn)?;
    Ok(())
}

fn migrate_legacy_roles(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE local_users SET role = 'doctor' WHERE role = 'admin'",
        [],
    )
    .ok();
    conn.execute(
        "UPDATE local_users SET role = 'assistant' WHERE role = 'staff'",
        [],
    )
    .ok();
    Ok(())
}

fn normalize_role(role: &str) -> &'static str {
    match role {
        "doctor" | "admin" => "doctor",
        "assistant" | "staff" => "assistant",
        _ => "assistant",
    }
}

fn can_manage_users(role: &str) -> bool {
    normalize_role(role) == "doctor"
}

fn migrate_legacy_device_lock(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM local_users WHERE active = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Ok(());
    }

    let path = legacy_lock_path();
    if !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let legacy: LegacyLockConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let ts = now_ts();

    conn.execute(
        "INSERT INTO local_users (id, display_name, role, pin_hash, active, created_at, updated_at)
         VALUES (?1, ?2, 'doctor', ?3, 1, ?4, ?4)",
        params![id, "Doktor", legacy.pin_hash, ts],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn row_to_user(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalUserRow> {
    Ok(LocalUserRow {
        id: row.get(0)?,
        display_name: row.get(1)?,
        role: row.get(2)?,
        pin_hash: row.get(3)?,
    })
}

pub fn is_configured(conn: &Connection) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM local_users WHERE active = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

pub fn list_users(conn: &Connection) -> Result<Vec<LocalUserPublic>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, display_name, role FROM local_users
             WHERE active = 1 ORDER BY display_name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LocalUserPublic {
                id: row.get(0)?,
                display_name: row.get(1)?,
                role: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn get_user_row(conn: &Connection, user_id: &str) -> Result<LocalUserRow, String> {
    conn.query_row(
        "SELECT id, display_name, role, pin_hash FROM local_users
         WHERE id = ?1 AND active = 1",
        params![user_id],
        row_to_user,
    )
    .map_err(|e| e.to_string())
}

fn set_session(user: &LocalUserRow) {
    if let Ok(mut guard) = SESSION.lock() {
        *guard = Some(LocalSession {
            user_id: user.id.clone(),
            display_name: user.display_name.clone(),
            role: user.role.clone(),
        });
    }
}

pub fn current_session() -> Option<LocalSession> {
    SESSION.lock().ok().and_then(|g| g.clone())
}

pub fn is_logged_in() -> bool {
    current_session().is_some()
}

pub fn lock() {
    if let Ok(mut guard) = SESSION.lock() {
        *guard = None;
    }
}

pub fn status(conn: &Connection) -> Result<LocalAuthStatus, String> {
    Ok(LocalAuthStatus {
        configured: is_configured(conn)?,
        logged_in: is_logged_in(),
        user: current_session(),
    })
}

pub fn setup_first_user(
    conn: &Connection,
    display_name: &str,
    pin: &str,
) -> Result<LocalSession, String> {
    if is_configured(conn)? {
        return Err("Kullanıcı zaten tanımlı — giriş yapın".into());
    }
    let name = display_name.trim();
    if name.is_empty() {
        return Err("Ad soyad boş olamaz".into());
    }

    let pin_hash = hash_pin(pin)?;
    let id = Uuid::new_v4().to_string();
    let ts = now_ts();

    conn.execute(
        "INSERT INTO local_users (id, display_name, role, pin_hash, active, created_at, updated_at)
         VALUES (?1, ?2, 'doctor', ?3, 1, ?4, ?4)",
        params![id, name, pin_hash, ts],
    )
    .map_err(|e| e.to_string())?;

    let user = get_user_row(conn, &id)?;
    set_session(&user);
    Ok(current_session().unwrap())
}

pub fn login(conn: &Connection, user_id: &str, pin: &str) -> Result<bool, String> {
    let user = get_user_row(conn, user_id)?;
    let ok = verify_pin_hash(pin, &user.pin_hash)?;
    if ok {
        set_session(&user);
    }
    Ok(ok)
}

pub fn create_user(
    conn: &Connection,
    display_name: &str,
    pin: &str,
    role: &str,
) -> Result<LocalUserPublic, String> {
    let session = current_session().ok_or("Oturum gerekli")?;
    if !can_manage_users(&session.role) {
        return Err("Yalnızca doktor yeni kullanıcı ekleyebilir".into());
    }

    let name = display_name.trim();
    if name.is_empty() {
        return Err("Ad soyad boş olamaz".into());
    }
    let user_role = normalize_role(role);
    let pin_hash = hash_pin(pin)?;
    let id = Uuid::new_v4().to_string();
    let ts = now_ts();

    conn.execute(
        "INSERT INTO local_users (id, display_name, role, pin_hash, active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
        params![id, name, user_role, pin_hash, ts],
    )
    .map_err(|e| e.to_string())?;

    Ok(LocalUserPublic {
        id,
        display_name: name.to_string(),
        role: user_role.to_string(),
    })
}

pub fn change_pin(
    conn: &Connection,
    user_id: &str,
    current_pin: &str,
    new_pin: &str,
) -> Result<(), String> {
    let session = current_session().ok_or("Oturum gerekli")?;
    if session.user_id != user_id && !can_manage_users(&session.role) {
        return Err("Bu kullanıcının PIN'ini değiştiremezsiniz".into());
    }

    let user = get_user_row(conn, user_id)?;

    if can_manage_users(&session.role) && session.user_id != user_id {
        let pin_hash = hash_pin(new_pin)?;
        conn.execute(
            "UPDATE local_users SET pin_hash = ?1, updated_at = ?2 WHERE id = ?3",
            params![pin_hash, now_ts(), user_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    if !verify_pin_hash(current_pin, &user.pin_hash)? {
        return Err("Mevcut PIN hatalı".into());
    }

    let pin_hash = hash_pin(new_pin)?;
    conn.execute(
        "UPDATE local_users SET pin_hash = ?1, updated_at = ?2 WHERE id = ?3",
        params![pin_hash, now_ts(), user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn audit_actor() -> (Option<String>, Option<String>) {
    current_session()
        .map(|s| (Some(s.user_id), Some(s.display_name)))
        .unwrap_or((None, None))
}
