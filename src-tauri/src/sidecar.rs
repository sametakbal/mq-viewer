//! Owns the Java sidecar process (IBM MQ allclient) and its line-delimited JSON-RPC channel.
//!
//! The process is started lazily on the first call and restarted on the next call if it dies;
//! requests carry an id so several can be in flight while the sidecar works on them in parallel.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, Value>>>>>;

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
    running: Mutex<Option<Running>>,
    pending: Pending,
    next_id: AtomicU64,
}

impl Sidecar {
    pub fn new(launch: Launch) -> Self {
        Self {
            launch,
            running: Mutex::new(None),
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
            .stderr(Stdio::inherit())
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
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(msg) = serde_json::from_str::<Value>(&line) else {
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
            for (_, tx) in pending.lock().await.drain() {
                let _ = tx.send(Err(local_error(
                    "SIDECAR_EXITED",
                    "The MQ sidecar process exited unexpectedly",
                )));
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
}
