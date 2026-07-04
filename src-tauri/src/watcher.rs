use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize)]
pub struct ScanDetectedPayload {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
}

pub struct FolderWatcher {
    stop_flag: Arc<AtomicBool>,
}

impl FolderWatcher {
    pub fn start(
        app: AppHandle,
        folder: String,
        extensions: Vec<String>,
        focus_on_new_scan: bool,
    ) -> Result<Self, String> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_flag.clone();
        let app_clone = app.clone();

        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
            rt.block_on(async {
                run_watcher(app_clone, folder, extensions, focus_on_new_scan, stop_clone).await;
            });
        });

        Ok(Self { stop_flag })
    }

    pub fn stop(self) {
        self.stop_flag.store(true, Ordering::SeqCst);
    }
}

async fn run_watcher(
    app: AppHandle,
    folder: String,
    extensions: Vec<String>,
    focus_on_new_scan: bool,
    stop: Arc<AtomicBool>,
) {
    let (tx, rx) = std::sync::mpsc::channel();

    let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
        Ok(d) => d,
        Err(e) => {
            log::error!("Watcher başlatılamadı: {e}");
            return;
        }
    };

    if let Err(e) = debouncer
        .watcher()
        .watch(Path::new(&folder), notify::RecursiveMode::NonRecursive)
    {
        log::error!("Klasör izlenemedi: {e}");
        return;
    }

    log::info!("Klasör izleniyor: {folder}");

    while !stop.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(Ok(events)) => {
                for event in events {
                    if event.kind != DebouncedEventKind::Any {
                        continue;
                    }
                    let path = &event.path;
                    if !is_scan_file(path, &extensions) {
                        continue;
                    }
                    if !path.is_file() {
                        continue;
                    }

                    let filename = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();

                    let size_bytes = std::fs::metadata(path)
                        .map(|m| m.len())
                        .unwrap_or(0);

                    let payload = ScanDetectedPayload {
                        path: path.to_string_lossy().to_string(),
                        filename,
                        size_bytes,
                    };

                    let _ = app.emit("scan-detected", &payload);

                    if focus_on_new_scan {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            }
            Ok(Err(e)) => log::error!("Watcher hatası: {e}"),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    log::info!("Klasör izleme durduruldu");
}

fn is_scan_file(path: &Path, extensions: &[String]) -> bool {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => e.to_lowercase(),
        None => return false,
    };
    if extensions.is_empty() {
        return ["stl", "ply", "dcm"].contains(&ext.as_str());
    }
    extensions
        .iter()
        .any(|e| e.trim().trim_start_matches('.').to_lowercase() == ext)
}
