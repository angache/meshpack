/// Dosya öneki normalizasyonu — JS `matching/stemKeys.js` ile uyumlu tutulmalı.

fn fold_tr(c: char) -> char {
    match c {
        'ç' | 'Ç' => 'c',
        'ğ' | 'Ğ' => 'g',
        'ı' => 'i',
        'İ' => 'i',
        'ö' | 'Ö' => 'o',
        'ş' | 'Ş' => 's',
        'ü' | 'Ü' => 'u',
        c if c.is_ascii() => c.to_ascii_lowercase(),
        c => c.to_ascii_lowercase(),
    }
}

pub fn normalize_stem_key(stem: &str) -> String {
    stem.chars()
        .map(fold_tr)
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn strip_version_suffix(mut key: String) -> String {
    for marker in ["_rev", "_copy", "_v"] {
        if let Some(pos) = key.rfind(marker) {
            let rest = &key[pos + marker.len()..];
            if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
                key.truncate(pos);
                return strip_version_suffix(key);
            }
        }
    }

    let trimmed: String = key.trim_end_matches(|c: char| c.is_ascii_digit()).to_string();
    if trimmed.len() >= 3 {
        trimmed.trim_end_matches('_').to_string()
    } else {
        key
    }
}

pub fn canonical_stem_key(stem: &str) -> String {
    let raw = normalize_stem_key(stem);
    if raw.is_empty() {
        return String::new();
    }
    strip_version_suffix(raw)
}

pub fn stem_lookup_keys(stem: &str) -> Vec<String> {
    let raw = normalize_stem_key(stem);
    let canonical = canonical_stem_key(stem);
    let mut keys = Vec::new();
    if !raw.is_empty() {
        keys.push(raw);
    }
    if !canonical.is_empty() && !keys.iter().any(|k| k == &canonical) {
        keys.push(canonical);
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_turkish_and_separators() {
        assert_eq!(normalize_stem_key("Serdal-Tinic"), "serdaltinic");
        assert_eq!(canonical_stem_key("serdaltinic2"), "serdaltinic");
    }
}
