import { useState, type ReactNode } from "react";
import { useApp } from "../../state";
import { secretKey, secrets, store } from "../../lib/rpc";
import type { Interval, Theme } from "../../lib/types";
import { Icon, Segmented, Switch } from "../ui";
import { KEYCHAIN } from "./ConnectionDrawer";

const CCSIDS: [number, string][] = [
  [1208, "UTF-8"], [819, "ISO-8859-1"], [1252, "Windows-1252"], [1254, "Windows-1254 (Turkish)"], [920, "ISO-8859-9 (Turkish)"],
  [37, "EBCDIC US/Canada"], [500, "EBCDIC International"], [1026, "EBCDIC Turkish"],
];

function Row({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr)", gap: 20, alignItems: "center", padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }}>
      <div><div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div><div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div></div>
      <div>{children}</div>
    </div>
  );
}

export default function SettingsDialog() {
  const settings = useApp((s) => s.settings);
  const connections = useApp((s) => s.connections);
  const { saveSettings, setOverlay, showToast } = useApp.getState();
  const [limit, setLimit] = useState(String(settings.browseLimit));
  const [confirm, setConfirm] = useState(false);
  const saved = connections.filter((c) => c.savePassword);

  const commitLimit = () => {
    const v = Math.max(10, Math.min(5000, Number(limit) || 50));
    setLimit(String(v));
    void saveSettings({ browseLimit: v });
  };

  const forgetAll = async () => {
    for (const c of saved) {
      await Promise.all([secrets.delete(secretKey.password(c.id)), secrets.delete(secretKey.keystore(c.id)), secrets.delete(secretKey.truststore(c.id))]).catch(() => undefined);
    }
    // Live connections keep working; the next connect will need the password again.
    const updated = connections.map((c) => (c.savePassword ? { ...c, savePassword: false } : c));
    useApp.setState({ connections: updated });
    await store.write("connections", { version: 1, connections: updated });
    setConfirm(false);
    showToast({ tone: "ok", title: "Saved passwords removed", sub: `${saved.length} connection${saved.length === 1 ? "" : "s"} will ask again` });
  };

  const themes: [Theme, string, string, string][] = [
    ["dark", "Dark", "ph-moon", "#16191d"], ["light", "Light", "ph-sun", "#f7f8f9"], ["system", "System", "ph-monitor", "linear-gradient(90deg,#16191d 50%,#f7f8f9 50%)"],
  ];

  return (
    <div className="modal" style={{ top: 110, width: 720 }}>
      <div style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 12px 0 22px", borderBottom: "1px solid var(--line)" }}>
        <Icon name="ph-gear-six" size={19} color="var(--muted)" />
        <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Settings</span>
        <button className="icon-btn" onClick={() => setOverlay(null)}><Icon name="ph-x" /></button>
      </div>
      <div style={{ padding: "6px 22px 20px", overflow: "auto" }}>
        <Row title="Theme" sub="Applies to all windows">
          <div style={{ display: "flex", gap: 8 }}>
            {themes.map(([k, label, icon, prev]) => (
              <div key={k} onClick={() => void saveSettings({ theme: k })} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, padding: 8, borderRadius: 7, border: `1px solid ${settings.theme === k ? "var(--accent)" : "var(--line2)"}`, cursor: "pointer", background: settings.theme === k ? "var(--accent-bg)" : "transparent" }}>
                <div style={{ height: 44, borderRadius: 4, background: prev, border: "1px solid var(--line)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}><Icon name={icon} />{label}</div>
              </div>
            ))}
          </div>
        </Row>
        <Row title="Browse limit" sub="Messages fetched per page">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input className="input mono" style={{ width: 110 }} value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} onBlur={commitLimit} onKeyDown={(e) => e.key === "Enter" && commitLimit()} />
            <span style={{ fontSize: 12, color: "var(--faint)" }}>10 – 5,000. Large pages slow down MQGET browse on deep queues.</span>
          </div>
        </Row>
        <Row title="Auto-refresh interval" sub="Queue depth and browse view">
          <div style={{ background: "var(--bg)", width: "max-content", borderRadius: 6 }}>
            <Segmented<Interval>
              mono
              value={settings.refreshInterval}
              onChange={(v) => void saveSettings({ refreshInterval: v })}
              options={([2, 5, 10, 30, 0] as Interval[]).map((v) => ({ value: v, label: v ? `${v}s` : "Off" }))}
            />
          </div>
        </Row>
        <Row title="Default encoding" sub="CCSID used for Put and decoding">
          <select className="input mono" style={{ width: 280 }} value={settings.defaultCcsid} onChange={(e) => void saveSettings({ defaultCcsid: Number(e.target.value) })}>
            {CCSIDS.map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
          </select>
        </Row>
        <Row title="Control characters" sub="CR, LF, TAB, SOH, STX, ETX… in payloads">
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, cursor: "pointer" }} onClick={() => void saveSettings({ showControlChars: !settings.showControlChars })}>
            <Switch on={settings.showControlChars} onChange={(v) => void saveSettings({ showControlChars: v })} />
            Show as markers
            <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>e.g. A<span style={{ color: "var(--warn)" }}>[SOH]</span>B<span>[CR][LF]</span> · ␍␊ in the list</span>
          </div>
        </Row>
        <div style={{ marginTop: 16, padding: 14, display: "flex", gap: 12, borderRadius: 7, background: "var(--bg)", border: "1px solid var(--line)" }}>
          <Icon name="ph-shield-check" size={22} color="var(--ok)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Saved passwords live in your OS secure storage</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5, textWrap: "pretty" }}>
              {KEYCHAIN}, under service <span className="mono" style={{ color: "var(--text)" }}>mq-viewer</span>. Connection files and JSON exports only store a reference — never the password or keystore secret.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              {confirm ? (
                <>
                  <button className="btn danger sm" onClick={() => void forgetAll()}>Yes, forget {saved.length}</button>
                  <button className="btn ghost sm" onClick={() => setConfirm(false)}>Cancel</button>
                </>
              ) : (
                <button className="btn danger sm" onClick={() => setConfirm(true)} disabled={!saved.length}>Forget all saved passwords</button>
              )}
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{saved.length} connection{saved.length === 1 ? "" : "s"} with saved secrets</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
