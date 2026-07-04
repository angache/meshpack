use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub watch_folder: Option<String>,
    pub drive_connected: bool,
    pub drive_token: Option<String>,

    // Görünüm
    pub theme: String,
    pub font_size: String,
    pub font_family: String,

    // Düzen
    pub preview_width: u32,
    pub preview_height: u32,
    pub layout_order: String,
    pub layout_density: String,

    // İzleme
    pub focus_on_new_scan: bool,
    pub file_extensions: Vec<String>,

    // Gönderim
    pub drive_folder_name: String,
    pub zip_name_template: String,
    pub after_upload: String,
    pub archive_folder: Option<String>,
    pub auto_upload: bool,

    // Önizleme
    pub visibility_upper: bool,
    pub visibility_lower: bool,
    pub visibility_bite: bool,
    pub color_upper: String,
    pub color_lower: String,
    pub color_bite: String,
    pub camera_preset: String,

    // Hizalama
    pub lower_jaw_offset_mm: f64,

    // Genel
    pub language: String,
    pub start_fullscreen: bool,
    pub session_timeout_min: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicConfig {
    pub watch_folder: Option<String>,
    pub drive_connected: bool,
    pub theme: String,
    pub font_size: String,
    pub font_family: String,
    pub preview_width: u32,
    pub preview_height: u32,
    pub layout_order: String,
    pub layout_density: String,
    pub focus_on_new_scan: bool,
    pub file_extensions: Vec<String>,
    pub drive_folder_name: String,
    pub zip_name_template: String,
    pub after_upload: String,
    pub archive_folder: Option<String>,
    pub auto_upload: bool,
    pub visibility_upper: bool,
    pub visibility_lower: bool,
    pub visibility_bite: bool,
    pub color_upper: String,
    pub color_lower: String,
    pub color_bite: String,
    pub camera_preset: String,
    pub lower_jaw_offset_mm: f64,
    pub language: String,
    pub start_fullscreen: bool,
    pub session_timeout_min: u32,
}

impl From<AppConfig> for PublicConfig {
    fn from(config: AppConfig) -> Self {
        Self {
            watch_folder: config.watch_folder,
            drive_connected: config.drive_connected,
            theme: config.theme,
            font_size: config.font_size,
            font_family: config.font_family,
            preview_width: config.preview_width,
            preview_height: config.preview_height,
            layout_order: config.layout_order,
            layout_density: config.layout_density,
            focus_on_new_scan: config.focus_on_new_scan,
            file_extensions: config.file_extensions,
            drive_folder_name: config.drive_folder_name,
            zip_name_template: config.zip_name_template,
            after_upload: config.after_upload,
            archive_folder: config.archive_folder,
            auto_upload: config.auto_upload,
            visibility_upper: config.visibility_upper,
            visibility_lower: config.visibility_lower,
            visibility_bite: config.visibility_bite,
            color_upper: config.color_upper,
            color_lower: config.color_lower,
            color_bite: config.color_bite,
            camera_preset: config.camera_preset,
            lower_jaw_offset_mm: config.lower_jaw_offset_mm,
            language: config.language,
            start_fullscreen: config.start_fullscreen,
            session_timeout_min: config.session_timeout_min,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            watch_folder: None,
            drive_connected: false,
            drive_token: None,
            theme: "dark".to_string(),
            font_size: "normal".to_string(),
            font_family: "system".to_string(),
            preview_width: 576,
            preview_height: 480,
            layout_order: "list-preview".to_string(),
            layout_density: "comfortable".to_string(),
            focus_on_new_scan: true,
            file_extensions: vec![
                "stl".to_string(),
                "ply".to_string(),
                "dcm".to_string(),
            ],
            drive_folder_name: "MeshPack".to_string(),
            zip_name_template: "{patient}_{date}".to_string(),
            after_upload: "none".to_string(),
            archive_folder: None,
            auto_upload: false,
            visibility_upper: true,
            visibility_lower: true,
            visibility_bite: false,
            color_upper: "#c9b87a".to_string(),
            color_lower: "#c9b87a".to_string(),
            color_bite: "#d45c5c".to_string(),
            camera_preset: "default".to_string(),
            lower_jaw_offset_mm: 0.0,
            language: "tr".to_string(),
            start_fullscreen: false,
            session_timeout_min: 15,
        }
    }
}

impl AppConfig {
    fn config_path() -> PathBuf {
        let dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("meshpack");
        fs::create_dir_all(&dir).ok();
        dir.join("config.json")
    }

    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::config_path();
        if !path.exists() {
            return Ok(Self::default());
        }
        let data = fs::read_to_string(&path)?;
        let mut config: Self = serde_json::from_str(&data)?;
        if config.file_extensions.is_empty() {
            config.file_extensions = AppConfig::default().file_extensions;
        }
        Ok(config)
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Self::config_path();
        let data = serde_json::to_string_pretty(self)?;
        fs::write(path, data)?;
        Ok(())
    }

    pub fn merge_public(&mut self, patch: PublicConfig) {
        self.watch_folder = patch.watch_folder;
        self.theme = patch.theme;
        self.font_size = patch.font_size;
        self.font_family = patch.font_family;
        self.preview_width = patch.preview_width;
        self.preview_height = patch.preview_height;
        self.layout_order = patch.layout_order;
        self.layout_density = patch.layout_density;
        self.focus_on_new_scan = patch.focus_on_new_scan;
        if !patch.file_extensions.is_empty() {
            self.file_extensions = patch.file_extensions;
        }
        self.drive_folder_name = patch.drive_folder_name;
        self.zip_name_template = patch.zip_name_template;
        self.after_upload = patch.after_upload;
        self.archive_folder = patch.archive_folder;
        self.auto_upload = patch.auto_upload;
        self.visibility_upper = patch.visibility_upper;
        self.visibility_lower = patch.visibility_lower;
        self.visibility_bite = patch.visibility_bite;
        self.color_upper = patch.color_upper;
        self.color_lower = patch.color_lower;
        self.color_bite = patch.color_bite;
        self.camera_preset = patch.camera_preset;
        self.lower_jaw_offset_mm = patch.lower_jaw_offset_mm;
        self.language = patch.language;
        self.start_fullscreen = patch.start_fullscreen;
        self.session_timeout_min = patch.session_timeout_min.max(1);
    }
}
