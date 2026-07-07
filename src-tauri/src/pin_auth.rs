use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::rngs::OsRng;

pub const MIN_PIN_LEN: usize = 4;
pub const MAX_PIN_LEN: usize = 64;

pub fn validate_pin(pin: &str) -> Result<(), String> {
    let len = pin.chars().count();
    if len < MIN_PIN_LEN {
        return Err(format!("PIN en az {MIN_PIN_LEN} karakter olmalı"));
    }
    if len > MAX_PIN_LEN {
        return Err(format!("PIN en fazla {MAX_PIN_LEN} karakter olabilir"));
    }
    Ok(())
}

pub fn hash_pin(pin: &str) -> Result<String, String> {
    validate_pin(pin)?;
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

pub fn verify_pin_hash(pin: &str, encoded: &str) -> Result<bool, String> {
    let parsed = PasswordHash::new(encoded).map_err(|e| e.to_string())?;
    Ok(Argon2::default()
        .verify_password(pin.as_bytes(), &parsed)
        .is_ok())
}
