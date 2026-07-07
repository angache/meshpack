use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const SERVICE: &str = "com.meshpack.app";
const MASTER_KEY_ACCOUNT: &str = "secure-vault-master";
const NONCE_LEN: usize = 12;

static VAULT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize, Default)]
struct Vault {
    entries: HashMap<String, String>,
}

fn secure_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("meshpack")
        .join("secure");
    fs::create_dir_all(&dir).ok();
    dir
}

fn vault_path() -> PathBuf {
    secure_dir().join("vault.enc")
}

fn master_key_path() -> PathBuf {
    secure_dir().join("master.key")
}

fn load_master_key_from_keyring() -> Option<[u8; 32]> {
    let entry = keyring::Entry::new(SERVICE, MASTER_KEY_ACCOUNT).ok()?;
    let encoded = entry.get_password().ok()?;
    let bytes = B64.decode(encoded).ok()?;
    if bytes.len() != 32 {
        return None;
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Some(key)
}

fn save_master_key_to_keyring(key: &[u8; 32]) -> bool {
    let Ok(entry) = keyring::Entry::new(SERVICE, MASTER_KEY_ACCOUNT) else {
        return false;
    };
    entry.set_password(&B64.encode(key)).is_ok()
}

fn load_master_key_from_file() -> Option<[u8; 32]> {
    let bytes = fs::read(master_key_path()).ok()?;
    if bytes.len() != 32 {
        return None;
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Some(key)
}

fn save_master_key_to_file(key: &[u8; 32]) -> Result<(), String> {
    let path = master_key_path();
    fs::write(&path, key).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).ok();
    }
    Ok(())
}

fn get_or_create_master_key() -> Result<[u8; 32], String> {
    if let Some(key) = load_master_key_from_keyring() {
        return Ok(key);
    }
    if let Some(key) = load_master_key_from_file() {
        save_master_key_to_keyring(&key);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);

    if !save_master_key_to_keyring(&key) {
        save_master_key_to_file(&key)?;
    }
    Ok(key)
}

fn encrypt_vault(vault: &Vault, key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let plaintext = serde_json::to_vec(vault).map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt_vault(data: &[u8], key: &[u8; 32]) -> Result<Vault, String> {
    if data.len() <= NONCE_LEN {
        return Err("Geçersiz kasa dosyası".into());
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Kasa çözülemedi".to_string())?;
    serde_json::from_slice(&plaintext).map_err(|e| e.to_string())
}

fn read_vault() -> Result<Vault, String> {
    let path = vault_path();
    if !path.exists() {
        return Ok(Vault::default());
    }
    let data = fs::read(&path).map_err(|e| e.to_string())?;

    // Keychain ve dosya anahtarlarını dene (senkron kayması olabilir)
    let mut keys_tried: Vec<[u8; 32]> = Vec::new();
    if let Some(k) = load_master_key_from_keyring() {
        keys_tried.push(k);
    }
    if let Some(k) = load_master_key_from_file() {
        if !keys_tried.iter().any(|x| x == &k) {
            keys_tried.push(k);
        }
    }

    for key in &keys_tried {
        if let Ok(vault) = decrypt_vault(&data, key) {
            save_master_key_to_keyring(key);
            return Ok(vault);
        }
    }

    // Bozuk veya eski kasa — yedekle, sıfırdan başla (cloud oturumu yeniden yazılır)
    let backup = secure_dir().join(format!(
        "vault.enc.bak-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ));
    fs::rename(&path, &backup).ok();
  fs::remove_file(&path).ok();
    log::warn!(
        "Şifreli kasa okunamadı, yedeklendi: {:?}. Cloud oturumu yeniden kaydedilecek.",
        backup
    );
    Ok(Vault::default())
}

fn write_vault(vault: &Vault) -> Result<(), String> {
    let key = get_or_create_master_key()?;
    let encrypted = encrypt_vault(vault, &key)?;
    let path = vault_path();
    fs::write(&path, encrypted).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).ok();
    }
    Ok(())
}

fn with_vault_mut<F>(f: F) -> Result<(), String>
where
    F: FnOnce(&mut Vault) -> Result<(), String>,
{
    let _guard = VAULT_LOCK.lock().map_err(|e| e.to_string())?;
    let mut vault = read_vault()?;
    f(&mut vault)?;
    write_vault(&vault)
}

pub fn secure_get(key: &str) -> Result<Option<String>, String> {
    if key.is_empty() {
        return Err("Anahtar boş olamaz".into());
    }
    let _guard = VAULT_LOCK.lock().map_err(|e| e.to_string())?;
    let vault = read_vault()?;
    Ok(vault.entries.get(key).cloned())
}

pub fn secure_set(key: &str, value: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("Anahtar boş olamaz".into());
    }
    with_vault_mut(|vault| {
        vault.entries.insert(key.to_string(), value.to_string());
        Ok(())
    })
}

pub fn secure_remove(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("Anahtar boş olamaz".into());
    }
    with_vault_mut(|vault| {
        vault.entries.remove(key);
        Ok(())
    })
}

pub fn secure_clear_prefix(prefix: &str) -> Result<usize, String> {
    let _guard = VAULT_LOCK.lock().map_err(|e| e.to_string())?;
    let mut vault = read_vault()?;
    let before = vault.entries.len();
    vault.entries.retain(|k, _| !k.starts_with(prefix));
    let removed = before.saturating_sub(vault.entries.len());
    write_vault(&vault)?;
    Ok(removed)
}
