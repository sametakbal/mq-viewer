//! Local persistence: JSON documents under ~/.mq-viewer and secrets in the OS keyring.

use std::path::PathBuf;

use serde_json::Value;

pub const KEYRING_SERVICE: &str = "mq-viewer";

/// Documents the UI may read and write; anything else is rejected.
const DOCUMENTS: &[&str] = &["connections", "settings", "templates"];

pub fn data_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".mq-viewer")
}

fn document_path(name: &str) -> Result<PathBuf, String> {
    if !DOCUMENTS.contains(&name) {
        return Err(format!("unknown document '{name}'"));
    }
    Ok(data_dir().join(format!("{name}.json")))
}

pub fn read_document(name: &str) -> Result<Value, String> {
    let path = document_path(name)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Writes via a temp file + rename so a crash never leaves a half-written document.
pub fn write_document(name: &str, value: &Value) -> Result<(), String> {
    let path = document_path(name)?;
    std::fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// The v1 Swing app stored connections as a properties file; returned raw for the UI to import.
pub fn legacy_connections() -> Option<String> {
    std::fs::read_to_string(data_dir().join("connections.properties")).ok()
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())
}

pub fn secret_get(key: &str) -> Result<Option<String>, String> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn secret_set(key: &str, value: &str) -> Result<(), String> {
    entry(key)?.set_password(value).map_err(|e| e.to_string())
}

pub fn secret_delete(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_documents_are_addressable() {
        assert!(document_path("connections").is_ok());
        assert!(document_path("../etc/passwd").is_err());
    }
}
