import { useEffect, useMemo, useState } from "react";
import { newConnection, useApp } from "../../state";
import { api, asMqError, secretKey, secrets, store } from "../../lib/rpc";
import { ENV_COLOR, SWATCHES, platformLabel, tlsLabel } from "../../lib/format";
import { explain } from "../../lib/mqrc";
import { exportConnectionsToFile, importConnectionsFromFile, pickKeystore } from "../../lib/transfer";
import type { Connection, Env, MqError, QmgrInfo } from "../../lib/types";
import { Checkbox, Field, Icon, Spinner, Switch } from "../ui";

export const KEYCHAIN = /Mac/i.test(navigator.userAgent) ? "macOS Keychain" : /Windows/i.test(navigator.userAgent) ? "Windows Credential Manager" : "the system keyring";

const CIPHERS = [
  ["*TLS13ORHIGHER", "TLS 1.3+ (any)"], ["*TLS12ORHIGHER", "TLS 1.2+ (any)"],
  ["TLS_AES_256_GCM_SHA384", "TLS 1.3"], ["TLS_AES_128_GCM_SHA256", "TLS 1.3"], ["TLS_CHACHA20_POLY1305_SHA256", "TLS 1.3"],
  ["TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384", "TLS 1.2"], ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256", "TLS 1.2"],
  ["TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384", "TLS 1.2"], ["TLS_RSA_WITH_AES_256_GCM_SHA384", "TLS 1.2"],
  ["TLS_RSA_WITH_AES_128_CBC_SHA256", "TLS 1.2"],
] as const;

type TestState = { s: "idle" } | { s: "testing" } | { s: "ok"; info: QmgrInfo } | { s: "err"; error: MqError };

export default function ConnectionDrawer({ connId }: { connId?: string }) {
  const existing = useApp((s) => s.connections.find((c) => c.id === connId));
  const connections = useApp((s) => s.connections);
  const folders = useMemo(() => [...new Set(connections.map((c) => c.folder).filter(Boolean))], [connections]);
  const { saveConnection, deleteConnection, setOverlay, openQueues, showToast } = useApp.getState();
  const [c, setC] = useState<Connection>(() => (existing ? structuredClone(existing) : newConnection()));
  const [pw, setPw] = useState("");
  const [ksPw, setKsPw] = useState("");
  const [tsPw, setTsPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [test, setTest] = useState<TestState>({ s: "idle" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dataDir, setDataDir] = useState("~/.mq-viewer");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    // Shown with the home folder abbreviated, as on macOS/Linux.
    void store.dataDir().then((d) => setDataDir(d.replace(/^.*[\\/](\.mq-viewer)$/, "~/$1"))).catch(() => undefined);
  }, []);

  const set = (patch: Partial<Connection>) => setC((x) => ({ ...x, ...patch }));
  const setTls = (patch: Partial<Connection["tls"]>) => setC((x) => ({ ...x, tls: { ...x.tls, ...patch } }));
  const hasSaved = !!existing?.savePassword;

  const errors = {
    name: !c.name.trim(), host: !c.host.trim(), port: !(c.port > 0 && c.port < 65536), channel: !c.channel.trim(),
  };
  const valid = !Object.values(errors).some(Boolean);

  const revealPw = async () => {
    if (!showPw && !pw && hasSaved) {
      const saved = await secrets.get(secretKey.password(c.id)).catch(() => null);
      if (saved) setPw(saved);
    }
    setShowPw(!showPw);
  };

  const runTest = async () => {
    setTest({ s: "testing" });
    try {
      // Empty fields mean "use what is saved" — the Tauri side fills them from the keyring.
      const info = await api.test(c, { password: pw || null, keystorePassword: ksPw || null, truststorePassword: tsPw || null });
      setTest({ s: "ok", info });
    } catch (e) {
      setTest({ s: "err", error: asMqError(e) });
    }
  };

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    try {
      const fresh = { ...c, name: c.name.trim(), host: c.host.trim(), channel: c.channel.trim(), qmgr: c.qmgr.trim() };
      await saveConnection(fresh, { password: pw || null, keystorePassword: ksPw || null, truststorePassword: tsPw || null });
      setOverlay(null);
      if (!existing) openQueues(fresh.id);
      showToast({ tone: "ok", title: existing ? "Connection saved" : `Added ${fresh.name}`, sub: c.savePassword && (pw || hasSaved) ? `Password stored in ${KEYCHAIN}` : undefined });
    } catch (e) {
      showToast({ tone: "err", title: "Could not save the connection", sub: e instanceof Error ? e.message : String(e) });
    }
  };

  const browseFile = async (field: "keystore" | "truststore") => {
    const p = await pickKeystore();
    if (p) setTls({ [field]: p });
  };

  const inputCls = (bad: boolean) => `input mono${touched && bad ? " invalid" : ""}`;

  return (
    <div className="drawer">
      <div style={{ height: 58, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 12px 0 20px", borderBottom: "1px solid var(--line)" }}>
        <Icon name="ph-plug" size={20} color="var(--accent)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{existing ? "Edit connection" : "New connection"}</div>
          <div className="ellipsis" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Stored in {dataDir}/connections.json · secrets in {KEYCHAIN}</div>
        </div>
        <button className="icon-btn" onClick={() => setOverlay(null)}><Icon name="ph-x" /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 22px", display: "flex", flexDirection: "column", gap: 20 }}>
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="section-title">GENERAL</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
            <Field label="Connection name">
              <input className={`input${touched && errors.name ? " invalid" : ""}`} autoFocus value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="payments-prod-01" spellCheck={false} />
            </Field>
            <Field label="Folder">
              <div className="input">
                <Icon name="ph-folder-simple" color="var(--muted)" />
                <input list="mq-folders" value={c.folder} onChange={(e) => set({ folder: e.target.value })} placeholder={c.env} spellCheck={false} />
                <datalist id="mq-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
              </div>
            </Field>
            <Field label="Environment">
              <div style={{ display: "flex", gap: 6 }}>
                {(["DEV", "TEST", "PROD"] as Env[]).map((k) => (
                  <span
                    key={k}
                    onClick={() => set({ env: k, folder: c.folder === c.env || !c.folder ? k : c.folder })}
                    className="mono"
                    style={{ flex: 1, height: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 5, border: `1px solid ${c.env === k ? ENV_COLOR[k] : "var(--line2)"}`, background: c.env === k ? "var(--raised)" : "transparent", color: c.env === k ? "var(--text)" : "var(--muted)", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", cursor: "pointer" }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: ENV_COLOR[k] }} />{k}
                  </span>
                ))}
              </div>
            </Field>
            <Field label="Color">
              <div style={{ height: 30, display: "flex", alignItems: "center", gap: 10, paddingLeft: 4 }}>
                {SWATCHES.map((sw, i) => (
                  <span key={sw} onClick={() => set({ color: i })} style={{ width: 18, height: 18, borderRadius: "50%", background: sw, boxShadow: i === c.color ? `0 0 0 2px var(--panel), 0 0 0 4px ${sw}` : "none", cursor: "pointer" }} />
                ))}
              </div>
            </Field>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="section-title">QUEUE MANAGER</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 96px", gap: 12 }}>
            <Field label="Host"><input className={inputCls(errors.host)} value={c.host} onChange={(e) => set({ host: e.target.value })} spellCheck={false} /></Field>
            <Field label="Port"><input className={inputCls(errors.port)} type="number" value={c.port} onChange={(e) => set({ port: Number(e.target.value) })} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
            <Field label="Queue manager"><input className="input mono" value={c.qmgr} onChange={(e) => set({ qmgr: e.target.value })} placeholder="(default)" spellCheck={false} /></Field>
            <Field label="Channel"><input className={inputCls(errors.channel)} value={c.channel} onChange={(e) => set({ channel: e.target.value })} spellCheck={false} /></Field>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="section-title">AUTHENTICATION</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
            <Field label="Username"><input className="input mono" value={c.user} onChange={(e) => set({ user: e.target.value })} placeholder="(none)" spellCheck={false} autoComplete="off" /></Field>
            <Field label="Password">
              <div className="input mono" style={{ paddingRight: 4 }}>
                <input type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={hasSaved ? "•••••••• (saved)" : ""} autoComplete="new-password" />
                <span onClick={() => void revealPw()} style={{ width: 24, height: 24, display: "grid", placeItems: "center", color: "var(--muted)", cursor: "pointer", fontSize: 15 }}>
                  <Icon name={showPw ? "ph-eye-slash" : "ph-eye"} />
                </span>
              </div>
            </Field>
          </div>
          <div onClick={() => set({ savePassword: !c.savePassword })} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, cursor: "pointer" }}>
            <Checkbox on={c.savePassword} large />
            Save password in {KEYCHAIN}
            <span style={{ color: "var(--faint)", fontSize: 11.5 }}>— never written to config or exports</span>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, border: `1px solid ${c.tls.enabled ? "var(--accent-line)" : "var(--line)"}`, borderRadius: 8, background: c.tls.enabled ? "var(--accent-bg)" : "transparent" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="ph-lock-simple" size={17} color={c.tls.enabled ? "var(--accent)" : "var(--muted)"} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Encrypted connection (SSL/TLS)</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>Must match SSLCIPH on channel {c.channel || "…"}</div>
            </div>
            <Switch large on={c.tls.enabled} onChange={(v) => setTls({ enabled: v })} />
          </div>
          {c.tls.enabled && (
            <>
              <Field label="Cipher spec">
                <select className="input mono" value={c.tls.cipher} onChange={(e) => setTls({ cipher: e.target.value })}>
                  {!CIPHERS.some(([k]) => k === c.tls.cipher) && <option value={c.tls.cipher}>{c.tls.cipher}</option>}
                  {CIPHERS.map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
                </select>
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 190px", gap: 12 }}>
                <Field label="Keystore (client certificate)">
                  <div className="input mono" style={{ paddingRight: 4 }}>
                    <Icon name="ph-key" color="var(--muted)" />
                    <input value={c.tls.keystore} onChange={(e) => setTls({ keystore: e.target.value })} placeholder=".p12 / .jks (optional)" spellCheck={false} />
                    <span className="input-btn" onClick={() => void browseFile("keystore")}>Browse…</span>
                  </div>
                </Field>
                <Field label="Keystore password">
                  <input className="input mono" type="password" value={ksPw} onChange={(e) => setKsPw(e.target.value)} placeholder={hasSaved && c.tls.keystore ? "•••••••• (saved)" : ""} autoComplete="new-password" />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 190px", gap: 12 }}>
                <Field label="Truststore (CA certificates)">
                  <div className="input mono" style={{ paddingRight: 4 }}>
                    <Icon name="ph-certificate" color="var(--muted)" />
                    <input value={c.tls.truststore} onChange={(e) => setTls({ truststore: e.target.value })} placeholder="Java default CAs" spellCheck={false} />
                    <span className="input-btn" onClick={() => void browseFile("truststore")}>Browse…</span>
                  </div>
                </Field>
                <Field label="Truststore password">
                  <input className="input mono" type="password" value={tsPw} onChange={(e) => setTsPw(e.target.value)} placeholder={hasSaved && c.tls.truststore ? "•••••••• (saved)" : "(none)"} autoComplete="new-password" />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                <Field label="Certificate label"><input className="input mono" value={c.tls.certLabel} onChange={(e) => setTls({ certLabel: e.target.value })} placeholder="keystore alias (optional)" spellCheck={false} /></Field>
                <Field label="SSL peer name"><input className="input mono" value={c.tls.peerName} onChange={(e) => setTls({ peerName: e.target.value })} placeholder="CN=*,O=… (optional)" spellCheck={false} /></Field>
              </div>
            </>
          )}
        </section>
      </div>

      {test.s === "ok" && (
        <div className="banner ok" style={{ margin: "0 20px 12px" }}>
          <Icon name="ph-check-circle" size={18} color="var(--ok)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>Connected in {test.info.elapsedMs} ms</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
              {[test.info.qmgr, `IBM MQ ${test.info.version}`, `CMDLEVEL ${test.info.cmdLevel}`, platformLabel(test.info.platform), test.info.tlsProtocol ? `${tlsLabel(test.info.tlsProtocol)} negotiated` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      )}
      {test.s === "err" && (
        <div className="banner err" style={{ margin: "0 20px 12px" }}>
          <Icon name="ph-warning-octagon" size={18} color="var(--err)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--err)" }}>{test.error.code ? `MQRC ${test.error.code} · ` : ""}{test.error.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, lineHeight: 1.45 }}>
              {explain(test.error).desc}
              {test.error.detail && <div className="mono" style={{ fontSize: 11, marginTop: 4, wordBreak: "break-word" }}>{test.error.detail}</div>}
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 60, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 20px", borderTop: "1px solid var(--line)" }}>
        {existing && (confirmDelete ? (
          <>
            <span style={{ fontSize: 12, color: "var(--err)" }}>Delete {existing.name}?</span>
            <button className="btn danger sm" onClick={() => { void deleteConnection(existing.id); setOverlay(null); }}>Delete</button>
            <button className="btn ghost sm" onClick={() => setConfirmDelete(false)}>Keep</button>
          </>
        ) : (
          <button className="btn danger-ghost sm" onClick={() => setConfirmDelete(true)}><Icon name="ph-trash" />Delete</button>
        ))}
        {!confirmDelete && (
          <>
            <button className="icon-btn" title="Import connections (JSON)" onClick={() => void importConnectionsFromFile()}><Icon name="ph-download-simple" /></button>
            <button className="icon-btn" title="Export this connection (JSON, without secrets)" onClick={() => void exportConnectionsToFile([c])} disabled={!valid}><Icon name="ph-upload-simple" /></button>
          </>
        )}
        <div className="spacer" />
        <button className="btn lg" onClick={() => void runTest()} disabled={!valid || test.s === "testing"}>
          {test.s === "testing" ? <Spinner /> : <Icon name="ph-lightning" />}Test connection
        </button>
        <button className="btn outline lg" onClick={() => setOverlay(null)}>Cancel</button>
        <button className="btn primary lg" style={{ padding: "0 16px" }} onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}
