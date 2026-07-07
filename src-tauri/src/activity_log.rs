use crate::local_users;
use rusqlite::{params, Connection};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ActivityLogEntry {
    pub id: String,
    pub category: String,
    pub action: String,
    pub summary: String,
    pub details: Option<String>,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub patient_id: Option<String>,
    pub case_id: Option<String>,
    pub created_at: i64,
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn migrate_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS activity_log (
            id TEXT PRIMARY KEY NOT NULL,
            category TEXT NOT NULL,
            action TEXT NOT NULL,
            summary TEXT NOT NULL,
            details TEXT,
            user_id TEXT,
            user_name TEXT,
            patient_id TEXT,
            case_id TEXT,
            created_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_activity_log_category ON activity_log(category, created_at DESC)",
        [],
    )
    .ok();

    Ok(())
}

pub fn write(
    conn: &Connection,
    category: &str,
    action: &str,
    summary: &str,
    details: Option<&str>,
    patient_id: Option<&str>,
    case_id: Option<&str>,
) -> Result<(), String> {
    let (user_id, user_name) = local_users::audit_actor();
    conn.execute(
        "INSERT INTO activity_log (
            id, category, action, summary, details, user_id, user_name, patient_id, case_id, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            Uuid::new_v4().to_string(),
            category,
            action,
            summary,
            details,
            user_id,
            user_name,
            patient_id,
            case_id,
            now_ts()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list(
    conn: &Connection,
    limit: i64,
    category: Option<&str>,
) -> Result<Vec<ActivityLogEntry>, String> {
    let capped = limit.clamp(1, 500);

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityLogEntry> {
        Ok(ActivityLogEntry {
            id: row.get(0)?,
            category: row.get(1)?,
            action: row.get(2)?,
            summary: row.get(3)?,
            details: row.get(4)?,
            user_id: row.get(5)?,
            user_name: row.get(6)?,
            patient_id: row.get(7)?,
            case_id: row.get(8)?,
            created_at: row.get(9)?,
        })
    }

    if let Some(cat) = category.filter(|c| !c.is_empty() && *c != "all") {
        let mut stmt = conn
            .prepare(
                "SELECT id, category, action, summary, details, user_id, user_name, patient_id, case_id, created_at
                 FROM activity_log WHERE category = ?1
                 ORDER BY created_at DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cat, capped], map_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, category, action, summary, details, user_id, user_name, patient_id, case_id, created_at
                 FROM activity_log
                 ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![capped], map_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
}

pub fn case_status_label(status: &str) -> &str {
    match status {
        "linked" => "Bağlandı",
        "planning" => "Planlanıyor",
        "ready_to_send" => "Gönderime hazır",
        "sent" => "Gönderildi",
        _ => status,
    }
}

pub fn scan_action_summary(action: &str, file_path: Option<&str>, reason: Option<&str>) -> String {
    let file = file_path
        .and_then(|p| std::path::Path::new(p).file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let mut parts = vec![match action {
        "link" => "Ölçü hastaya bağlandı".to_string(),
        "reassign" => "Ölçü yeniden atandı".to_string(),
        "detach" => "Ölçü kaldırıldı".to_string(),
        "case_create" => "Vaka oluşturuldu".to_string(),
        "reject_suggestion" => "Hasta önerisi reddedildi".to_string(),
        other => other.to_string(),
    }];
    if !file.is_empty() {
        parts.push(file.to_string());
    }
    if let Some(r) = reason.filter(|s| !s.is_empty()) {
        parts.push(format!("Gerekçe: {r}"));
    }
    parts.join(" · ")
}
