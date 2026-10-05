//! Owns the Java sidecar process (IBM MQ allclient) and its line-delimited JSON-RPC channel.
//!
//! The process is started lazily on the first call and restarted on the next call if it dies;
//! requests carry an id so several can be in flight while the sidecar works on them in parallel.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, Value>>>>>;
type Slot = Arc<Mutex<Option<Running>>>;

/// The sidecar's stderr (JVM errors, MQ client output) goes here, inside `Launch::work_dir`.
const STDERR_LOG: &str = "sidecar.log";
/// The log is appended to across restarts, so a crash survives the respawn; start over past this.
const STDERR_LOG_MAX: u64 = 5 * 1024 * 1024;

/// Where to find the JVM and the shaded jar.
#[derive(Clone, Debug)]
pub struct Launch {
    pub java: PathBuf,
    pub jar: PathBuf,
    pub work_dir: PathBuf,
}

struct Running {
    child: Child,
    stdin: ChildStdin,
}

pub struct Sidecar {
    launch: Launch,
    running: Slot,
    pending: Pending,
    next_id: AtomicU64,
}

impl Sidecar {
    pub fn new(launch: Launch) -> Self {
        Self {
            launch,
            running: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let line = json!({ "id": id, "method": method, "params": params }).to_string() + "\n";
        if let Err(e) = self.send(&line).await {
            self.pending.lock().await.remove(&id);
            return Err(local_error("SIDECAR_UNAVAILABLE", &e));
        }

        match rx.await {
            Ok(res) => res,
            Err(_) => Err(local_error("SIDECAR_EXITED", "The MQ sidecar process exited while handling the request")),
        }
    }

    async fn send(&self, line: &str) -> Result<(), String> {
        let mut guard = self.running.lock().await;
        let alive = match guard.as_mut() {
            Some(r) => matches!(r.child.try_wait(), Ok(None)),
            None => false,
        };
        if !alive {
            *guard = Some(self.spawn()?);
        }
        let r = guard.as_mut().expect("sidecar just started");
        if let Err(e) = r.stdin.write_all(line.as_bytes()).await {
            *guard = None;
            return Err(format!("write to sidecar failed: {e}"));
        }
        r.stdin.flush().await.map_err(|e| format!("flush to sidecar failed: {e}"))
    }

    fn spawn(&self) -> Result<Running, String> {
        let l = &self.launch;
        if !l.jar.exists() {
            return Err(format!("sidecar jar not found at {}", l.jar.display()));
        }
        let _ = std::fs::create_dir_all(&l.work_dir);

        let mut cmd = Command::new(&l.java);
        cmd.arg("-Xss1m")
            .arg("-XX:+UseSerialGC")
            .arg("-Dfile.encoding=UTF-8")
            .arg("-Dcom.ibm.msg.client.commonservices.log.outputName=mqviewer-client.log")
            .arg("-jar")
            .arg(&l.jar)
            .current_dir(&l.work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(open_stderr_log(&l.work_dir))
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", l.java.display()))?;
        let stdin = child.stdin.take().ok_or("sidecar stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("sidecar stdout unavailable")?;

        let pending = self.pending.clone();
        let running = self.running.clone();
        let pid = child.id();
        let log_path = l.work_dir.join(STDERR_LOG);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).split(b'\n');
            // Decoded lossily: a stray non-UTF-8 byte must not end the channel while the process lives on.
            while let Ok(Some(raw)) = lines.next_segment().await {
                let line = String::from_utf8_lossy(&raw);
                let Ok(msg) = serde_json::from_str::<Value>(line.trim_end()) else {
                    continue;
                };
                let Some(id) = msg.get("id").and_then(Value::as_u64) else {
                    continue;
                };
                if let Some(tx) = pending.lock().await.remove(&id) {
                    let res = match msg.get("error") {
                        Some(err) if !err.is_null() => Err(err.clone()),
                        _ => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                    };
                    let _ = tx.send(res);
                }
            }
            // stdout closed: the process is gone, fail whatever was still waiting.
            let message = format!(
                "The MQ sidecar process exited unexpectedly ({}). See {} for details.",
                exit_status(&running, pid).await,
                log_path.display()
            );
            for (_, tx) in pending.lock().await.drain() {
                let _ = tx.send(Err(local_error("SIDECAR_EXITED", &message)));
            }
        });

        Ok(Running { child, stdin })
    }

    pub async fn shutdown(&self) {
        if let Some(mut r) = self.running.lock().await.take() {
            let _ = r.child.kill().await;
        }
    }
}

/// Appends to the stderr log, starting it over once it has grown past `STDERR_LOG_MAX`.
fn open_stderr_log(dir: &Path) -> Stdio {
    let path = dir.join(STDERR_LOG);
    let too_big = std::fs::metadata(&path).is_ok_and(|m| m.len() > STDERR_LOG_MAX);
    let mut opts = OpenOptions::new();
    if too_big {
        opts.write(true).create(true).truncate(true);
    } else {
        opts.append(true).create(true);
    }
    match opts.open(&path) {
        Ok(mut f) => {
            let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
            let _ = writeln!(f, "--- sidecar starting (unix time {secs}) ---");
            Stdio::from(f)
        }
        Err(_) => Stdio::null(),
    }
}

/// How the process `pid` ended, as long as it is still the one in `slot` (not already reaped and
/// replaced by a restart).
async fn exit_status(slot: &Slot, pid: Option<u32>) -> String {
    let mut guard = slot.lock().await;
    let Some(r) = guard.as_mut().filter(|r| pid.is_some() && r.child.id() == pid) else {
        return "exit status unknown".into();
    };
    match tokio::time::timeout(Duration::from_secs(2), r.child.wait()).await {
        Ok(Ok(status)) => status.to_string(),
        _ => "exit status unknown".into(),
    }
}

pub fn local_error(name: &str, message: &str) -> Value {
    json!({ "code": 0, "name": name, "cc": 2, "message": message })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_error_shape_matches_sidecar_errors() {
        let e = local_error("SIDECAR_EXITED", "gone");
        assert_eq!(e["code"], 0);
        assert_eq!(e["name"], "SIDECAR_EXITED");
        assert_eq!(e["message"], "gone");
    }

    #[test]
    fn stderr_log_appends_across_restarts() {
        let dir = std::env::temp_dir().join(format!("mqviewer-sidecar-log-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(STDERR_LOG);
        std::fs::write(&path, "previous crash\n").unwrap();

        drop(open_stderr_log(&dir));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("previous crash\n"));
        assert!(text.contains("--- sidecar starting"));

        std::fs::write(&path, vec![b'x'; STDERR_LOG_MAX as usize + 1]).unwrap();
        drop(open_stderr_log(&dir));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("--- sidecar starting"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn early_exit_reports_status_and_keeps_stderr() {
        let java = if cfg!(windows) { "java.exe" } else { "java" };
        if std::process::Command::new(java).arg("-version").output().is_err() {
            return; // no JVM on this machine
        }
        let dir = std::env::temp_dir().join(format!("mqviewer-sidecar-exit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let jar = dir.join("broken.jar");
        std::fs::write(&jar, "not a jar").unwrap();

        let sidecar = Sidecar::new(Launch { java: PathBuf::from(java), jar, work_dir: dir.clone() });
        let err = sidecar.call("ping", json!({})).await.unwrap_err();
        assert_eq!(err["name"], "SIDECAR_EXITED");
        let message = err["message"].as_str().unwrap();
        assert!(message.contains("exit code"), "{message}");

        let log = std::fs::read_to_string(dir.join(STDERR_LOG)).unwrap();
        assert!(log.contains("broken.jar"), "{log}");

        drop(sidecar);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
