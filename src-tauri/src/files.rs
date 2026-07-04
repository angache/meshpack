use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::SystemTime;

const DEFAULT_EXTENSIONS: &[&str] = &["stl", "ply", "dcm"];

#[derive(Debug, Clone, Serialize)]
pub struct ScanFileEntry {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub modified_at: i64,
}

pub fn list_scan_files(folder: &str, extensions: &[String]) -> Result<Vec<ScanFileEntry>, String> {
    let exts: Vec<String> = if extensions.is_empty() {
        DEFAULT_EXTENSIONS
            .iter()
            .map(|e| e.to_string())
            .collect()
    } else {
        extensions
            .iter()
            .map(|e| e.trim().trim_start_matches('.').to_lowercase())
            .filter(|e| !e.is_empty())
            .collect()
    };

    let dir = Path::new(folder);
    if !dir.exists() {
        return Err(format!("Klasör bulunamadı: {folder}"));
    }
    if !dir.is_dir() {
        return Err(format!("Geçerli bir klasör değil: {folder}"));
    }

    let mut entries = Vec::new();

    let read_dir = fs::read_dir(dir).map_err(|e| format!("Klasör okunamadı: {e}"))?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_scan_file(&path, &exts) {
            continue;
        }

        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        entries.push(ScanFileEntry {
            path: path.to_string_lossy().to_string(),
            filename: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            size_bytes: metadata.len(),
            modified_at,
        });
    }

    entries.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(entries)
}

fn is_scan_file(path: &Path, extensions: &[String]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| extensions.contains(&ext.to_lowercase()))
        .unwrap_or(false)
}
