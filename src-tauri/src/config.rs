use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub watch_folder: Option<String>,
    pub drive_connected: bool,
    pub drive_token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicConfig {
    pub watch_folder: Option<String>,
    pub drive_connected: bool,
}

impl From<AppConfig> for PublicConfig {
    fn from(config: AppConfig) -> Self {
        Self {
            watch_folder: config.watch_folder,
            drive_connected: config.drive_connected,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            watch_folder: None,
            drive_connected: false,
            drive_token: None,
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
        Ok(serde_json::from_str(&data)?)
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Self::config_path();
        let data = serde_json::to_string_pretty(self)?;
        fs::write(path, data)?;
        Ok(())
    }
}
