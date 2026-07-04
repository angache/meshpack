use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;
use uuid::Uuid;
use chrono::TimeZone;

pub const CASE_STATUS_LINKED: &str = "linked";
pub const CASE_STATUS_PLANNING: &str = "planning";
pub const CASE_STATUS_READY: &str = "ready_to_send";
pub const CASE_STATUS_SENT: &str = "sent";

#[derive(Debug, Clone, Serialize)]
pub struct Patient {
    pub id: String,
    pub surname: String,
    pub first_name: String,
    pub notes: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub scan_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Case {
    pub id: String,
    pub patient_id: String,
    pub case_number: String,
    pub status: String,
    pub session_day: String,
    pub lab_notes: String,
    pub tooth_shade: String,
    pub dental_plan: String,
    pub annotations: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub sent_at: Option<i64>,
    pub scan_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanLink {
    pub file_path: String,
    pub patient_id: String,
    pub case_id: Option<String>,
    pub filename: String,
    pub file_stem: String,
    pub scan_type: String,
    pub modified_at: i64,
    pub linked_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub id: String,
    pub action: String,
    pub file_path: Option<String>,
    pub from_patient_id: Option<String>,
    pub to_patient_id: Option<String>,
    pub from_case_id: Option<String>,
    pub to_case_id: Option<String>,
    pub reason: Option<String>,
    pub created_at: i64,
}

pub fn db_path() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("meshpack");
    std::fs::create_dir_all(&dir).ok();
    dir.join("meshpack.db")
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let has_case_id: bool = conn
        .prepare("PRAGMA table_info(scan_links)")
        .and_then(|mut stmt| {
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            let mut found = false;
            for name in rows.flatten() {
                if name == "case_id" {
                    found = true;
                    break;
                }
            }
            Ok(found)
        })
        .map_err(|e| e.to_string())?;

    if !has_case_id {
        conn.execute(
            "ALTER TABLE scan_links ADD COLUMN case_id TEXT REFERENCES cases(id) ON DELETE SET NULL",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_links_case ON scan_links(case_id)",
        [],
    )
    .map_err(|e| e.to_string())?;

    backfill_orphan_scan_links(conn)?;

    let has_dental_plan = table_has_column(conn, "cases", "dental_plan")?;
    if !has_dental_plan {
        conn.execute(
            "ALTER TABLE cases ADD COLUMN dental_plan TEXT NOT NULL DEFAULT '{}'",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    let has_annotations = table_has_column(conn, "cases", "annotations")?;
    if !has_annotations {
        conn.execute(
            "ALTER TABLE cases ADD COLUMN annotations TEXT NOT NULL DEFAULT '{\"version\":1,\"markers\":[]}'",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    let has_tooth_shade = table_has_column(conn, "cases", "tooth_shade")?;
    if !has_tooth_shade {
        conn.execute(
            "ALTER TABLE cases ADD COLUMN tooth_shade TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for name in rows.flatten() {
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn session_day_from_ts(ts: i64) -> String {
    chrono::Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(chrono::Local::now)
        .format("%Y-%m-%d")
        .to_string()
}

fn find_or_create_case_for_backfill(
    conn: &Connection,
    patient_id: &str,
    session_day: &str,
) -> Result<String, String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM cases WHERE patient_id = ?1 AND session_day = ?2 ORDER BY created_at ASC LIMIT 1",
            params![patient_id, session_day],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        return Ok(id);
    }

    let case_row = create_case(conn, patient_id, session_day)?;
    Ok(case_row.id)
}

/// Vaka sistemi öncesi bağlanmış ölçüler: hasta + gün bazında vaka oluşturur veya mevcut vakaya bağlar.
fn backfill_orphan_scan_links(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT file_path, patient_id, modified_at FROM scan_links WHERE case_id IS NULL")
        .map_err(|e| e.to_string())?;

    let orphans: Vec<(String, String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if orphans.is_empty() {
        return Ok(());
    }

    use std::collections::HashMap;
    let mut groups: HashMap<(String, String), Vec<String>> = HashMap::new();
    for (path, patient_id, modified_at) in orphans {
        let day = session_day_from_ts(modified_at);
        groups
            .entry((patient_id, day))
            .or_default()
            .push(path);
    }

    for ((patient_id, session_day), paths) in groups {
        let case_id = find_or_create_case_for_backfill(conn, &patient_id, &session_day)?;
        for path in paths {
            conn.execute(
                "UPDATE scan_links SET case_id = ?1 WHERE file_path = ?2 AND case_id IS NULL",
                params![case_id, path],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

pub fn open() -> Result<Connection, String> {
    let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY NOT NULL,
            surname TEXT NOT NULL DEFAULT '',
            first_name TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY NOT NULL,
            patient_id TEXT NOT NULL,
            case_number TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'linked',
            session_day TEXT NOT NULL,
            lab_notes TEXT NOT NULL DEFAULT '',
            dental_plan TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            sent_at INTEGER,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_cases_patient ON cases(patient_id);
        CREATE INDEX IF NOT EXISTS idx_cases_session_day ON cases(patient_id, session_day);
        CREATE TABLE IF NOT EXISTS scan_links (
            file_path TEXT PRIMARY KEY NOT NULL,
            patient_id TEXT NOT NULL,
            case_id TEXT,
            filename TEXT NOT NULL,
            file_stem TEXT NOT NULL DEFAULT '',
            scan_type TEXT NOT NULL DEFAULT 'unknown',
            modified_at INTEGER NOT NULL DEFAULT 0,
            linked_at INTEGER NOT NULL,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
            FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scan_links_patient ON scan_links(patient_id);
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY NOT NULL,
            action TEXT NOT NULL,
            file_path TEXT,
            from_patient_id TEXT,
            to_patient_id TEXT,
            from_case_id TEXT,
            to_case_id TEXT,
            reason TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS case_counters (
            year INTEGER PRIMARY KEY NOT NULL,
            seq INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    migrate(&conn)?;
    Ok(conn)
}

fn next_case_number(conn: &Connection) -> Result<String, String> {
    let year = chrono::Utc::now().format("%Y").to_string();
    let year_i: i32 = year.parse().unwrap_or(2026);

    conn.execute(
        "INSERT INTO case_counters (year, seq) VALUES (?1, 1)
         ON CONFLICT(year) DO UPDATE SET seq = seq + 1",
        params![year_i],
    )
    .map_err(|e| e.to_string())?;

    let seq: i64 = conn
        .query_row(
            "SELECT seq FROM case_counters WHERE year = ?1",
            params![year_i],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(format!("MP-{year}-{seq:04}"))
}

fn write_audit(
    conn: &Connection,
    action: &str,
    file_path: Option<&str>,
    from_patient_id: Option<&str>,
    to_patient_id: Option<&str>,
    from_case_id: Option<&str>,
    to_case_id: Option<&str>,
    reason: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO audit_log (id, action, file_path, from_patient_id, to_patient_id,
         from_case_id, to_case_id, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            Uuid::new_v4().to_string(),
            action,
            file_path,
            from_patient_id,
            to_patient_id,
            from_case_id,
            to_case_id,
            reason,
            now_ts()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_scan_link(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScanLink> {
    Ok(ScanLink {
        file_path: row.get(0)?,
        patient_id: row.get(1)?,
        case_id: row.get(2)?,
        filename: row.get(3)?,
        file_stem: row.get(4)?,
        scan_type: row.get(5)?,
        modified_at: row.get(6)?,
        linked_at: row.get(7)?,
    })
}

const SCAN_LINK_SELECT: &str =
    "SELECT file_path, patient_id, case_id, filename, file_stem, scan_type, modified_at, linked_at";

fn get_scan_link(conn: &Connection, file_path: &str) -> Result<Option<ScanLink>, String> {
    let mut stmt = conn
        .prepare(&format!("{SCAN_LINK_SELECT} FROM scan_links WHERE file_path = ?1"))
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(params![file_path], row_to_scan_link)
        .map_err(|e| e.to_string())?;

    Ok(rows.next().transpose().map_err(|e| e.to_string())?)
}

fn row_to_case(row: &rusqlite::Row<'_>) -> rusqlite::Result<Case> {
    Ok(Case {
        id: row.get(0)?,
        patient_id: row.get(1)?,
        case_number: row.get(2)?,
        status: row.get(3)?,
        session_day: row.get(4)?,
        lab_notes: row.get(5)?,
        tooth_shade: row.get(6)?,
        dental_plan: row.get(7)?,
        annotations: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        sent_at: row.get(11)?,
        scan_count: row.get(12)?,
    })
}

const CASE_SELECT: &str = "SELECT c.id, c.patient_id, c.case_number, c.status, c.session_day,
    c.lab_notes, c.tooth_shade, c.dental_plan, c.annotations, c.created_at, c.updated_at, c.sent_at,
    (SELECT COUNT(*) FROM scan_links s WHERE s.case_id = c.id) AS scan_count";

pub fn list_patients(conn: &Connection) -> Result<Vec<Patient>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.surname, p.first_name, p.notes, p.created_at, p.updated_at,
                    COUNT(s.file_path) AS scan_count
             FROM patients p
             LEFT JOIN scan_links s ON s.patient_id = p.id
             GROUP BY p.id
             ORDER BY p.updated_at DESC, p.surname COLLATE NOCASE, p.first_name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Patient {
                id: row.get(0)?,
                surname: row.get(1)?,
                first_name: row.get(2)?,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                scan_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_patient(conn: &Connection, id: &str) -> Result<Option<Patient>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.surname, p.first_name, p.notes, p.created_at, p.updated_at,
                    COUNT(s.file_path) AS scan_count
             FROM patients p
             LEFT JOIN scan_links s ON s.patient_id = p.id
             WHERE p.id = ?1
             GROUP BY p.id",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(params![id], |row| {
            Ok(Patient {
                id: row.get(0)?,
                surname: row.get(1)?,
                first_name: row.get(2)?,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                scan_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.next().transpose().map_err(|e| e.to_string())?)
}

pub fn create_patient(
    conn: &Connection,
    surname: &str,
    first_name: &str,
    notes: &str,
) -> Result<Patient, String> {
    let id = Uuid::new_v4().to_string();
    let ts = now_ts();
    conn.execute(
        "INSERT INTO patients (id, surname, first_name, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, surname.trim(), first_name.trim(), notes.trim(), ts],
    )
    .map_err(|e| e.to_string())?;

    get_patient(conn, &id)?.ok_or_else(|| "Hasta oluşturulamadı".to_string())
}

pub fn update_patient(
    conn: &Connection,
    id: &str,
    surname: &str,
    first_name: &str,
    notes: &str,
) -> Result<Patient, String> {
    let ts = now_ts();
    let changed = conn
        .execute(
            "UPDATE patients SET surname = ?2, first_name = ?3, notes = ?4, updated_at = ?5
             WHERE id = ?1",
            params![id, surname.trim(), first_name.trim(), notes.trim(), ts],
        )
        .map_err(|e| e.to_string())?;

    if changed == 0 {
        return Err("Hasta bulunamadı".to_string());
    }

    get_patient(conn, id)?.ok_or_else(|| "Hasta bulunamadı".to_string())
}

pub fn delete_patient(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM patients WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_case(conn: &Connection, patient_id: &str, session_day: &str) -> Result<Case, String> {
    if get_patient(conn, patient_id)?.is_none() {
        return Err("Hasta bulunamadı".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let case_number = next_case_number(conn)?;
    let ts = now_ts();

    conn.execute(
        "INSERT INTO cases (id, patient_id, case_number, status, session_day, lab_notes, dental_plan, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', '{}', ?6, ?6)",
        params![id, patient_id, case_number, CASE_STATUS_LINKED, session_day, ts],
    )
    .map_err(|e| e.to_string())?;

    write_audit(
        conn,
        "case_create",
        None,
        None,
        Some(patient_id),
        None,
        Some(&id),
        None,
    )?;

    get_case(conn, &id)?.ok_or_else(|| "Vaka oluşturulamadı".to_string())
}

pub fn get_case(conn: &Connection, id: &str) -> Result<Option<Case>, String> {
    let mut stmt = conn
        .prepare(&format!("{CASE_SELECT} FROM cases c WHERE c.id = ?1"))
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(params![id], row_to_case)
        .map_err(|e| e.to_string())?;

    Ok(rows.next().transpose().map_err(|e| e.to_string())?)
}

pub fn find_case_for_day(
    conn: &Connection,
    patient_id: &str,
    session_day: &str,
) -> Result<Option<Case>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{CASE_SELECT} FROM cases c
             WHERE c.patient_id = ?1 AND c.session_day = ?2 AND c.status != ?3
             ORDER BY c.created_at DESC LIMIT 1"
        ))
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(
            params![patient_id, session_day, CASE_STATUS_SENT],
            row_to_case,
        )
        .map_err(|e| e.to_string())?;

    Ok(rows.next().transpose().map_err(|e| e.to_string())?)
}

pub fn list_patient_cases(conn: &Connection, patient_id: &str) -> Result<Vec<Case>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{CASE_SELECT} FROM cases c
             WHERE c.patient_id = ?1
             ORDER BY c.created_at DESC"
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![patient_id], row_to_case)
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn update_case_status(conn: &Connection, case_id: &str, status: &str) -> Result<Case, String> {
    let ts = now_ts();
    let sent_at = if status == CASE_STATUS_SENT {
        Some(ts)
    } else {
        None
    };

    if status == CASE_STATUS_SENT {
        conn.execute(
            "UPDATE cases SET status = ?2, updated_at = ?3, sent_at = ?3 WHERE id = ?1",
            params![case_id, status, ts],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE cases SET status = ?2, updated_at = ?3 WHERE id = ?1",
            params![case_id, status, ts],
        )
        .map_err(|e| e.to_string())?;
    }

    let _ = sent_at;
    get_case(conn, case_id)?.ok_or_else(|| "Vaka bulunamadı".to_string())
}

pub fn update_case_lab_notes(
    conn: &Connection,
    case_id: &str,
    lab_notes: &str,
) -> Result<Case, String> {
    let ts = now_ts();
    let changed = conn
        .execute(
            "UPDATE cases SET lab_notes = ?2, updated_at = ?3,
             status = CASE WHEN status = ?4 THEN ?5 ELSE status END
             WHERE id = ?1",
            params![
                case_id,
                lab_notes.trim(),
                ts,
                CASE_STATUS_LINKED,
                CASE_STATUS_PLANNING
            ],
        )
        .map_err(|e| e.to_string())?;

    if changed == 0 {
        return Err("Vaka bulunamadı".to_string());
    }

    get_case(conn, case_id)?.ok_or_else(|| "Vaka bulunamadı".to_string())
}

pub fn update_case_planning(
    conn: &Connection,
    case_id: &str,
    lab_notes: &str,
    tooth_shade: &str,
    dental_plan: &str,
    annotations: &str,
) -> Result<Case, String> {
    if serde_json::from_str::<serde_json::Value>(dental_plan).is_err() {
        return Err("Geçersiz diş planı formatı".to_string());
    }
    if serde_json::from_str::<serde_json::Value>(annotations).is_err() {
        return Err("Geçersiz annotation formatı".to_string());
    }

    let ts = now_ts();
    let changed = conn
        .execute(
            "UPDATE cases SET lab_notes = ?2, tooth_shade = ?3, dental_plan = ?4, annotations = ?5, updated_at = ?6,
             status = CASE WHEN status = ?7 THEN ?8 ELSE status END
             WHERE id = ?1",
            params![
                case_id,
                lab_notes.trim(),
                tooth_shade.trim(),
                dental_plan.trim(),
                annotations.trim(),
                ts,
                CASE_STATUS_LINKED,
                CASE_STATUS_PLANNING
            ],
        )
        .map_err(|e| e.to_string())?;

    if changed == 0 {
        return Err("Vaka bulunamadı".to_string());
    }

    get_case(conn, case_id)?.ok_or_else(|| "Vaka bulunamadı".to_string())
}

pub fn list_scan_links(conn: &Connection) -> Result<Vec<ScanLink>, String> {
    let mut stmt = conn
        .prepare(&format!("{SCAN_LINK_SELECT} FROM scan_links ORDER BY modified_at DESC"))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_scan_link)
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn list_patient_scans(conn: &Connection, patient_id: &str) -> Result<Vec<ScanLink>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{SCAN_LINK_SELECT} FROM scan_links WHERE patient_id = ?1 ORDER BY modified_at DESC"
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![patient_id], row_to_scan_link)
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn list_case_scans(conn: &Connection, case_id: &str) -> Result<Vec<ScanLink>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{SCAN_LINK_SELECT} FROM scan_links WHERE case_id = ?1 ORDER BY modified_at DESC"
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![case_id], row_to_scan_link)
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn link_scan(
    conn: &Connection,
    patient_id: &str,
    case_id: &str,
    file_path: &str,
    filename: &str,
    file_stem: &str,
    scan_type: &str,
    modified_at: i64,
) -> Result<ScanLink, String> {
    if get_patient(conn, patient_id)?.is_none() {
        return Err("Hasta bulunamadı".to_string());
    }
    if get_case(conn, case_id)?.is_none() {
        return Err("Vaka bulunamadı".to_string());
    }

    if let Some(existing) = get_scan_link(conn, file_path)? {
        if existing.patient_id != patient_id {
            return Err(
                "Bu ölçü başka bir hastaya bağlı. Eşleştirmeyi düzelt menüsünü kullanın.".to_string(),
            );
        }
    }

    let ts = now_ts();
    conn.execute(
        "INSERT INTO scan_links (file_path, patient_id, case_id, filename, file_stem, scan_type, modified_at, linked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(file_path) DO UPDATE SET
            case_id = excluded.case_id,
            filename = excluded.filename,
            file_stem = excluded.file_stem,
            scan_type = excluded.scan_type,
            modified_at = excluded.modified_at,
            linked_at = excluded.linked_at
         WHERE patient_id = excluded.patient_id",
        params![
            file_path,
            patient_id,
            case_id,
            filename,
            file_stem,
            scan_type,
            modified_at,
            ts
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE patients SET updated_at = ?2 WHERE id = ?1",
        params![patient_id, ts],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE cases SET updated_at = ?2 WHERE id = ?1",
        params![case_id, ts],
    )
    .map_err(|e| e.to_string())?;

    write_audit(
        conn,
        "link",
        Some(file_path),
        None,
        Some(patient_id),
        None,
        Some(case_id),
        None,
    )?;

    get_scan_link(conn, file_path)?
        .filter(|l| l.patient_id == patient_id && l.case_id.as_deref() == Some(case_id))
        .ok_or_else(|| "Bağlantı kaydedilemedi — ölçü başka hastaya ait olabilir".to_string())
}

pub fn reassign_scan(
    conn: &Connection,
    file_path: &str,
    to_patient_id: &str,
    to_case_id: &str,
    reason: &str,
) -> Result<ScanLink, String> {
    let reason = reason.trim();
    if reason.len() < 3 {
        return Err("Gerekçe en az 3 karakter olmalı".to_string());
    }

    let existing = get_scan_link(conn, file_path)?.ok_or_else(|| "Ölçü bağlı değil".to_string())?;

    if existing.patient_id == to_patient_id && existing.case_id.as_deref() == Some(to_case_id) {
        return Err("Ölçü zaten bu hastada".to_string());
    }

    if get_case(conn, to_case_id)?.is_none() {
        return Err("Hedef vaka bulunamadı".to_string());
    }

    let ts = now_ts();
    conn.execute(
        "UPDATE scan_links SET patient_id = ?2, case_id = ?3, linked_at = ?4 WHERE file_path = ?1",
        params![file_path, to_patient_id, to_case_id, ts],
    )
    .map_err(|e| e.to_string())?;

    write_audit(
        conn,
        "reassign",
        Some(file_path),
        Some(&existing.patient_id),
        Some(to_patient_id),
        existing.case_id.as_deref(),
        Some(to_case_id),
        Some(reason),
    )?;

    conn.execute(
        "UPDATE patients SET updated_at = ?2 WHERE id = ?1",
        params![to_patient_id, ts],
    )
    .ok();

    get_scan_link(conn, file_path)?.ok_or_else(|| "Yeniden atama başarısız".to_string())
}

pub fn detach_scan(conn: &Connection, file_path: &str, reason: &str) -> Result<(), String> {
    let reason = reason.trim();
    if reason.len() < 3 {
        return Err("Gerekçe en az 3 karakter olmalı".to_string());
    }

    let existing = get_scan_link(conn, file_path)?.ok_or_else(|| "Ölçü bağlı değil".to_string())?;

    if let Some(case_id) = existing.case_id.as_deref() {
        if let Some(case_row) = get_case(conn, case_id)? {
            if case_row.status == CASE_STATUS_SENT {
                return Err("Gönderilmiş vakadan ölçü kaldırılamaz".to_string());
            }
        }
    }

    write_audit(
        conn,
        "detach",
        Some(file_path),
        Some(&existing.patient_id),
        None,
        existing.case_id.as_deref(),
        None,
        Some(reason),
    )?;

    conn.execute("DELETE FROM scan_links WHERE file_path = ?1", params![file_path])
        .map_err(|e| e.to_string())?;

    Ok(())
}
