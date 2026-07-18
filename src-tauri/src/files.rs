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

fn entry_from_path(path: &Path) -> Result<ScanFileEntry, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(ScanFileEntry {
        path: path.to_string_lossy().to_string(),
        filename: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        size_bytes: metadata.len(),
        modified_at,
    })
}

fn canonical_path(path: &Path) -> Option<std::path::PathBuf> {
    path.canonicalize().ok()
}

/// Kaynak dosya zaten hedef klasörün içindeyse yeniden kopyalama.
fn is_path_in_dir(path: &Path, dir: &Path) -> bool {
    let Some(path) = canonical_path(path) else {
        return false;
    };
    let Some(dir) = canonical_path(dir) else {
        return false;
    };
    path.starts_with(&dir)
}

fn files_likely_same(a: &Path, b: &Path) -> bool {
    if canonical_path(a) == canonical_path(b) {
        return true;
    }
    let (Ok(ma), Ok(mb)) = (fs::metadata(a), fs::metadata(b)) else {
        return false;
    };
    ma.len() == mb.len()
}

fn resolve_import_dest(
    src_path: &Path,
    dest_dir: &Path,
    filename: &str,
) -> Result<std::path::PathBuf, String> {
    let dest_joined = dest_dir.join(filename);

    // Zaten izleme klasöründeki dosya — olduğu gibi kullan
    if is_path_in_dir(src_path, dest_dir) {
        return Ok(src_path.to_path_buf());
    }

    // Hedef ad mevcut ve içerik aynı → mevcut dosyayı kullan
    if dest_joined.exists() && files_likely_same(src_path, &dest_joined) {
        return Ok(dest_joined);
    }

    // Farklı içerik, aynı ad — yeni benzersiz ad
    if dest_joined.exists() {
        return Ok(unique_dest_path(dest_dir, filename));
    }

    Ok(dest_joined)
}

fn unique_dest_path(dest_dir: &Path, filename: &str) -> std::path::PathBuf {
    let dest = dest_dir.join(filename);
    if !dest.exists() {
        return dest;
    }

    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("scan");
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();

    let mut n = 1u32;
    loop {
        let candidate = dest_dir.join(format!("{stem}_{n}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Seçilen ölçü dosyalarını izleme klasörüne kopyalar.
pub fn import_scan_files(
    source_paths: &[String],
    dest_folder: &str,
    extensions: &[String],
) -> Result<Vec<ScanFileEntry>, String> {
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

    let dest_dir = Path::new(dest_folder);
    fs::create_dir_all(dest_dir).map_err(|e| format!("Klasör oluşturulamadı: {e}"))?;

    if source_paths.is_empty() {
        return Err("En az bir dosya seçin".into());
    }

    let mut imported = Vec::new();

    for src in source_paths {
        let src_path = Path::new(src);
        if !src_path.is_file() {
            return Err(format!("Dosya bulunamadı: {src}"));
        }
        if !is_scan_file(src_path, &exts) {
            return Err(format!(
                "Desteklenmeyen dosya: {}. İzin verilen: {}",
                src_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(src),
                exts.join(", ")
            ));
        }

        let filename = src_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("Geçersiz dosya adı: {src}"))?;

        let dest_path = resolve_import_dest(src_path, dest_dir, filename)?;

        let needs_copy = canonical_path(src_path) != canonical_path(&dest_path);

        if needs_copy {
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Klasör oluşturulamadı: {e}"))?;
            }
            fs::copy(src_path, &dest_path)
                .map_err(|e| format!("Kopyalanamadı {src}: {e}"))?;
        }

        imported.push(entry_from_path(&dest_path)?);
    }

    imported.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(imported)
}
