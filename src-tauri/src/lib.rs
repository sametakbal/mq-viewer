mod sidecar;
mod storage;

use std::path::PathBuf;

use base64::Engine;
use serde_json::Value;
use tauri::{Manager, RunEvent, State};

use sidecar::{local_error, Launch, Sidecar};

/// Forwards one operation to the Java sidecar. For "test" and "connect" the saved secrets are
/// filled in from the OS keyring here, so the UI never has to hold stored passwords.
#[tauri::command]
async fn mq_call(sidecar: State<'_, Sidecar>, method: String, mut params: Value) -> Result<Value, Value> {
    if method == "test" || method == "connect" {
        fill_secrets(&mut params).map_err(|e| local_error("KEYRING_ERROR", &e))?;
    }
    sidecar.call(&method, params).await
}

fn fill_secrets(params: &mut Value) -> Result<(), String> {
    let Some(conn) = params.get_mut("conn") else { return Ok(()) };
    let id = conn.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    if id.is_empty() {
        return Ok(());
    }
    if conn.get("password").map_or(true, Value::is_null) {
        if let Some(pw) = storage::secret_get(&id)? {
            conn["password"] = Value::String(pw);
        }
    }
    if let Some(tls) = conn.get_mut("tls").filter(|t| t.is_object()) {
        for (field, suffix) in [("keystorePassword", "keystore"), ("truststorePassword", "truststore")] {
            if tls.get(field).map_or(true, Value::is_null) {
                if let Some(pw) = storage::secret_get(&format!("{id}:{suffix}"))? {
                    tls[field] = Value::String(pw);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn doc_read(name: String) -> Result<Value, String> {
    storage::read_document(&name)
}

#[tauri::command]
fn doc_write(name: String, value: Value) -> Result<(), String> {
    storage::write_document(&name, &value)
}

#[tauri::command]
fn legacy_connections() -> Option<String> {
    storage::legacy_connections()
}

#[tauri::command]
fn data_dir() -> String {
    storage::data_dir().display().to_string()
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    storage::secret_get(&key)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    storage::secret_set(&key, &value)
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    storage::secret_delete(&key)
}

/// Files picked by the user through the native open/save dialogs.
#[tauri::command]
fn file_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn file_read_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn file_write_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn file_write_base64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
}

/// Bundled runtime + jar when installed; in development falls back to the local build and the
/// JDK on JAVA_HOME / PATH.
fn resolve_launch(resource_dir: Option<PathBuf>) -> Launch {
    let java_exe = if cfg!(windows) { "java.exe" } else { "java" };
    let work_dir = storage::data_dir().join("logs");

    if let Some(dir) = resource_dir {
        let java = dir.join("runtime").join("bin").join(java_exe);
        let jar = dir.join("mq-sidecar.jar");
        if java.exists() && jar.exists() {
            return Launch { java, jar, work_dir };
        }
        if jar.exists() {
            return Launch { java: system_java(java_exe), jar, work_dir };
        }
    }
    let jar = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sidecar")
        .join("target")
        .join("mq-sidecar.jar");
    Launch { java: system_java(java_exe), jar, work_dir }
}

fn system_java(java_exe: &str) -> PathBuf {
    std::env::var_os("JAVA_HOME")
        .map(|home| PathBuf::from(home).join("bin").join(java_exe))
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(java_exe))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let launch = resolve_launch(app.path().resource_dir().ok());
            app.manage(Sidecar::new(launch));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mq_call,
            doc_read,
            doc_write,
            legacy_connections,
            data_dir,
            secret_get,
            secret_set,
            secret_delete,
            file_read_text,
            file_read_base64,
            file_write_text,
            file_write_base64
        ])
        .build(tauri::generate_context!())
        .expect("error while building mq-viewer");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let sidecar = handle.state::<Sidecar>();
            tauri::async_runtime::block_on(sidecar.shutdown());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn explicit_password_is_not_overwritten() {
        let mut p = json!({ "conn": { "id": "", "password": "typed" } });
        fill_secrets(&mut p).unwrap();
        assert_eq!(p["conn"]["password"], "typed");
    }
}
