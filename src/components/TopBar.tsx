import { activeTabOf, connOf, queueAccess, useApp } from "../state";
import { EnvBadge, Icon, StatusDot } from "./ui";

const VERSION = "2.0.0";

export default function TopBar() {
  const tab = useApp(activeTabOf);
  const conn = useApp((s) => connOf(s, tab?.connId ?? s.focusConn));
  const status = useApp((s) => (conn ? s.status[conn.id] : undefined));
  const setOverlay = useApp((s) => s.setOverlay);
  const refreshBrowse = useApp((s) => s.refreshBrowse);
  const loadQueues = useApp((s) => s.loadQueues);
  const connect = useApp((s) => s.connect);
  const tabAccess = useApp((s) => (conn && tab?.queue ? queueAccess(s, conn.id, tab.queue) : null));

  const refresh = () => {
    if (!tab) return;
    if (useApp.getState().status[tab.connId]?.state !== "connected") void connect(tab.connId);
    else if (tab.kind === "browse") void refreshBrowse(tab.id, "poll");
    else void loadQueues(tab.connId);
  };

  const canPut = !!conn && status?.state === "connected";
  // Not the open queue when this user may not put there (probed, browse-only queues).
  const tabQueue = tab?.queue && (tabAccess?.put ?? true) ? tab.queue : undefined;
  const putQueue = tabQueue ?? conn?.defaultQueue
    ?? status?.queues?.find((q) => (q.access ? q.access.put : q.type === "Local" && !q.name.startsWith("SYSTEM.")))?.name ?? "";

  return (
    <div style={{ height: 48, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 12px", background: "var(--panel)", borderBottom: "1px solid var(--line)" }}>
      <div style={{ width: 238, display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: "var(--accent)", color: "var(--accent-ink)", display: "grid", placeItems: "center", font: "600 11px 'JetBrains Mono',monospace" }}>mq</div>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>mq-viewer</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{VERSION}</span>
      </div>
      {conn && (
        <button
          onClick={() => setOverlay({ kind: "connection", connId: conn.id })}
          title="Edit connection"
          style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px", background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer", maxWidth: 520 }}
        >
          <StatusDot state={status?.state} />
          <span className="ellipsis" style={{ fontWeight: 600 }}>{conn.name}</span>
          <EnvBadge env={conn.env} />
          <span style={{ color: "var(--faint)" }}>/</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{status?.info?.qmgr ?? conn.qmgr}</span>
          {conn.tls.enabled && <Icon name="ph-lock-simple" size={14} color="var(--muted)" />}
          <Icon name="ph-caret-down" size={12} color="var(--faint)" />
        </button>
      )}
      <div className="spacer" />
      <div
        onClick={() => setOverlay({ kind: "palette" })}
        style={{ width: 320, height: 30, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--faint)", fontSize: 12.5, cursor: "text" }}
      >
        <Icon name="ph-magnifying-glass" size={15} />
        <span style={{ flex: 1 }}>Search queues, MsgId, CorrelId…</span>
        <span className="kbd">Ctrl K</span>
      </div>
      <button className="icon-btn bordered" title="Refresh" onClick={refresh} disabled={!tab}><Icon name="ph-arrows-clockwise" /></button>
      <button className="icon-btn bordered" title="Settings (Ctrl ,)" onClick={() => setOverlay({ kind: "settings" })}><Icon name="ph-gear-six" /></button>
      <button
        className="btn primary lg"
        disabled={!canPut}
        title={canPut ? undefined : "Connect to a queue manager first"}
        onClick={() => conn && setOverlay({ kind: "put", connId: conn.id, queue: putQueue })}
      >
        <Icon name="ph-paper-plane-tilt" />Put message
      </button>
    </div>
  );
}
