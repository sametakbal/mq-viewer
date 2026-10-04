import { activeTabOf, connOf, useApp } from "../state";
import { clock, tlsLabel } from "../lib/format";
import { Icon } from "./ui";

export default function StatusBar() {
  const tab = useApp(activeTabOf);
  const conn = useApp((s) => connOf(s, tab?.connId ?? s.focusConn));
  const st = useApp((s) => (conn ? s.status[conn.id] : undefined));
  const b = useApp((s) => (tab ? s.browse[tab.id] : undefined));
  const interval = useApp((s) => s.settings.refreshInterval);

  let dot = "var(--faint)";
  let state = "No active connection";
  let right = "mq-viewer 2.0.0";
  const items: { icon: string; t: string }[] = [];

  if (conn) {
    items.push({ icon: "ph-hard-drives", t: `${conn.host}:${conn.port}` }, { icon: "ph-plugs-connected", t: conn.channel }, { icon: "ph-database", t: st?.info?.qmgr ?? conn.qmgr });
    if (st?.state === "connected" && st.info?.tlsProtocol) {
      items.push({ icon: "ph-lock-simple", t: [tlsLabel(st.info.tlsProtocol), st.info.tlsCipher].filter(Boolean).join(" · ") });
    } else if (conn.tls.enabled) {
      items.push({ icon: "ph-lock-simple", t: `TLS · ${conn.tls.cipher}` });
    }
    switch (st?.state) {
      case "connected":
        dot = "var(--ok)";
        state = "Connected";
        if (b?.browsedAt) right = `Last refresh ${clock(b.browsedAt)} · ${b.auto && interval ? `auto ${interval}s` : "auto off"}`;
        else if (st.queuesAt) right = `Queues refreshed ${clock(st.queuesAt)}`;
        else right = `Connected in ${st.info?.elapsedMs ?? "—"} ms`;
        break;
      case "connecting":
        dot = "var(--warn)";
        state = "Connecting…";
        right = tab?.queue ? `Opening ${tab.queue}` : `Opening ${conn.qmgr}`;
        break;
      case "error":
        dot = "var(--err)";
        state = `Disconnected · MQRC ${st.error?.code || st.error?.name}`;
        right = st.lastAttempt ? `Last attempt ${clock(st.lastAttempt)}` : "";
        break;
      default:
        state = "Disconnected";
        right = "";
    }
  }

  return (
    <div className="mono" style={{ height: 26, flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "0 12px", background: "var(--chrome)", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />{state}
      </span>
      {items.map((it) => (
        <span key={it.icon} style={{ display: "flex", alignItems: "center", gap: 5 }}><Icon name={it.icon} size={12} color="var(--faint)" />{it.t}</span>
      ))}
      <div className="spacer" />
      <span>{right}</span>
    </div>
  );
}
