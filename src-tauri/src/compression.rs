use chrono::Local;
use serde_json::Value;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

fn safe_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn zip_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6))
}

fn add_file_to_zip(
    zip: &mut ZipWriter<File>,
    file_path: &Path,
    entry_name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let options = zip_options();
    zip.start_file(entry_name, options)?;
    let mut file = File::open(file_path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;
    zip.write_all(&buffer)?;
    Ok(())
}

fn add_bytes_to_zip(
    zip: &mut ZipWriter<File>,
    entry_name: &str,
    data: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let options = zip_options();
    zip.start_file(entry_name, options)?;
    zip.write_all(data)?;
    Ok(())
}

/// Birden fazla tarama dosyasını tek ZIP'e sıkıştırır.
pub fn compress_scans(
    file_paths: &[String],
    patient_name: &str,
    zip_name_template: &str,
    alignment: Option<&Value>,
    summary_notes: Option<&str>,
    manifest_json: Option<&str>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if file_paths.is_empty() {
        return Err("Sıkıştırılacak dosya yok".into());
    }

    let now = Local::now();
    let date = now.format("%Y-%m-%d").to_string();
    let time = now.format("%H%M").to_string();
    let name = safe_name(patient_name);
    let zip_stem = zip_name_template
        .replace("{patient}", &name)
        .replace("{date}", &date)
        .replace("{time}", &time);
    let zip_stem = safe_name(&zip_stem);
    let zip_path = std::env::temp_dir().join(format!("{zip_stem}.zip"));

    let zip_file = File::create(&zip_path)?;
    let mut zip = ZipWriter::new(zip_file);

    for file_path in file_paths {
        let source = Path::new(file_path);
        if !source.exists() {
            return Err(format!("Dosya bulunamadı: {file_path}").into());
        }
        let entry_name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "scan.stl".to_string());
        add_file_to_zip(&mut zip, source, &entry_name)?;
    }

    if let Some(matrix_data) = alignment {
        let options = zip_options();
        zip.start_file("alignment.json", options)?;
        zip.write_all(serde_json::to_string_pretty(matrix_data)?.as_bytes())?;
    }

    if let Some(notes) = summary_notes {
        let trimmed = notes.trim();
        if !trimmed.is_empty() {
            add_bytes_to_zip(&mut zip, "is_emri.txt", trimmed.as_bytes())?;
        }
    }

    if let Some(manifest) = manifest_json {
        let trimmed = manifest.trim();
        if !trimmed.is_empty() {
            add_bytes_to_zip(&mut zip, "manifest.json", trimmed.as_bytes())?;
        }
    }

    zip.finish()?;
    log::info!("ZIP oluşturuldu: {} ({} dosya)", zip_path.display(), file_paths.len());

    Ok(zip_path)
}

/// ZIP'i İndirilenler/MeshPack altına kaydeder (e-posta eki için).
pub fn export_scans_zip(
    file_paths: &[String],
    patient_name: &str,
    zip_name_template: &str,
    summary_notes: Option<&str>,
    manifest_json: Option<&str>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let temp_zip = compress_scans(
        file_paths,
        patient_name,
        zip_name_template,
        None,
        summary_notes,
        manifest_json,
    )?;

    let export_dir = dirs::download_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("MeshPack");
    std::fs::create_dir_all(&export_dir)?;

    let file_name = temp_zip
        .file_name()
        .ok_or("ZIP adı oluşturulamadı")?
        .to_owned();
    let dest = export_dir.join(file_name);

    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }

    match std::fs::rename(&temp_zip, &dest) {
        Ok(()) => {}
        Err(_) => {
            std::fs::copy(&temp_zip, &dest)?;
            let _ = std::fs::remove_file(&temp_zip);
        }
    }

    log::info!("Vaka ZIP dışa aktarıldı: {}", dest.display());
    Ok(dest)
}

pub fn create_notes_file(notes: &str, patient_name: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let date = Local::now().format("%Y-%m-%d %H:%M").to_string();
    let name = safe_name(patient_name);
    let notes_path = std::env::temp_dir().join(format!("{name}_notlar.txt"));
    let content = format!(
        "MeshPack — Laboratuvar Notu\n\
         ===========================\n\
         Hasta: {patient_name}\n\
         Tarih: {date}\n\
         \n\
         {notes}\n"
    );
    std::fs::write(&notes_path, content)?;
    Ok(notes_path)
}
