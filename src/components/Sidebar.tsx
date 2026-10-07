import { useMemo, useState } from "react";
import { activeTabOf, useApp } from "../state";
import { n } from "../lib/format";
import { short } from "../lib/mqrc";
import { exportConnectionsToFile, importConnectionsFromFile } from "../lib/transfer";
import type { Connection, QueueInfo } from "../lib/types";
import { Icon, press, StatusDot } from "./ui";
import Drafts from "./Drafts";

const TREE_QUEUES = 5;

/** Most interesting queues first: deepest local queues, SYSTEM.* left out. */
function topQueues(queues: QueueInfo[]) {
  return queues
    // Probed queues (no PCF) are listed whatever their type: the user added them by name.
    .filter((q) => q.access || (q.type === "Local" && !q.name.startsWith("SYSTEM.")))
    .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0) || a.name.localeCompare(b.name));
}

function depthColor(q: QueueInfo) {
  if (q.depth == null || !q.maxDepth) return "var(--faint)";
  const pct = (q.depth / q.maxDepth) * 100;
  if (pct >= 85) return "var(--err)";
  if (pct >= 70) return "var(--warn)";
  return q.depth > 0 && q.ipprocs === 0 ? "var(--warn)" : "var(--faint)";
}

export default function Sidebar() {
  const connections = useApp((s) => s.connections);
  const status = useApp((s) => s.status);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const setOverlay = useApp((s) => s.setOverlay);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const map = new Map<string, Connection[]>();
    for (const c of connections) {
      if (f && !`${c.name} ${c.host} ${c.qmgr}`.toLowerCase().includes(f)) continue;
      const key = c.folder || c.env;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    const order = (k: string) => (k === "DEV" ? 0 : k === "TEST" ? 1 : k === "PROD" ? 3 : 2);
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [connections, filter]);

  const connected = Object.values(status).filter((s) => s.state === "connected").length;

  return (
    <aside style={{ width: 260, flex: "none", display: "flex", flexDirection: "column", background: "var(--panel)", borderRight: "1px solid var(--line)" }}>
      <div style={{ height: 38, flex: "none", display: "flex", alignItems: "center", gap: 2, padding: "0 8px 0 14px" }}>
        <span className="caps" style={{ flex: 1 }}>CONNECTIONS</span>
        <button className="icon-btn sm" title="New connection (Ctrl N)" onClick={() => setOverlay({ kind: "connection" })}><Icon name="ph-plus" /></button>
        <button className="icon-btn sm" title="Import JSON (Ctrl O)" onClick={() => void importConnectionsFromFile()}><Icon name="ph-download-simple" /></button>
        <button className="icon-btn sm" title="Export JSON" disabled={!connections.length} onClick={() => void exportConnectionsToFile()}><Icon name="ph-upload-simple" /></button>
      </div>
      <div style={{ padding: "0 10px 8px" }}>
        <div className="input" style={{ height: 28, fontSize: 12, padding: "0 9px", gap: 7 }}>
          <Icon name="ph-funnel-simple" size={13} color="var(--faint)" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter connections" spellCheck={false} />
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 8 }}>
        {groups.map(([name, conns]) => {
          const prod = conns.some((c) => c.env === "PROD");
          const open = !collapsed[name];
          return (
            <div key={name} style={{ position: "relative", padding: "2px 0 6px" }}>
              {prod && <div style={{ position: "absolute", left: 0, top: 2, bottom: 6, width: 3, background: "var(--prod)" }} />}
              <div
                {...press(() => setCollapsed((c) => ({ ...c, [name]: open })))} aria-expanded={open}
                style={{ height: 26, display: "flex", alignItems: "center", gap: 6, padding: "0 14px 0 12px", fontSize: 11, fontWeight: 600, letterSpacing: ".07em", color: prod ? "var(--err)" : "var(--muted)", cursor: "pointer", userSelect: "none" }}
              >
                <Icon name={open ? "ph-caret-down" : "ph-caret-right"} size={11} color="var(--faint)" />
                <Icon name="ph-folder-simple" size={14} />
                <span>{name.toUpperCase()}</span>
                <span style={{ marginLeft: "auto", fontWeight: 400, color: "var(--faint)", letterSpacing: 0 }}>{conns.length}</span>
              </div>
              {open && conns.map((c) => <ConnectionNode key={c.id} conn={c} />)}
            </div>
          );
        })}
        {connections.length === 0 && (
          <div style={{ margin: "24px 14px", padding: "20px 16px", border: "1px dashed var(--line2)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>No saved connections</div>
            <div style={{ fontSize: 12, color: "var(--muted)", textWrap: "pretty" }}>Add a queue manager or import a JSON config exported from another machine.</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button className="btn primary sm" onClick={() => setOverlay({ kind: "connection" })}><Icon name="ph-plus" />New</button>
              <button className="btn sm" onClick={() => void importConnectionsFromFile()}><Icon name="ph-download-simple" />Import</button>
            </div>
          </div>
        )}
      </div>
      <Drafts />
      <div style={{ height: 32, flex: "none", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 11.5, color: "var(--faint)" }}>
        {connections.length ? `${connections.length} connection${connections.length === 1 ? "" : "s"} · ${connected} connected` : "No connections"}
      </div>
    </aside>
  );
}

function ConnectionNode({ conn }: { conn: Connection }) {
  const st = useApp((s) => s.status[conn.id]);
  const tab = useApp(activeTabOf);
  const focus = useApp((s) => s.focusConn);
  const { connect, disconnect, openQueues, openBrowse, setOverlay } = useApp.getState();
  const [hover, setHover] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState(false);

  const connected = st?.state === "connected";
  const expanded = connected && !userCollapsed;
  const active = tab?.connId === conn.id || (!tab && focus === conn.id);
  const queues = st?.queues ? topQueues(st.queues) : [];

  const onRow = () => {
    useApp.setState({ focusConn: conn.id });
    if (connected) setUserCollapsed((v) => !v);
    else if (st?.state !== "connecting") {
      setUserCollapsed(false);
      openQueues(conn.id);
    }
  };

  return (
    <div>
      <div
        {...press(onRow)}
        onDoubleClick={() => setOverlay({ kind: "connection", connId: conn.id })}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="hoverable"
        style={{ height: 28, display: "flex", alignItems: "center", gap: 7, padding: "0 8px 0 24px", cursor: "pointer", background: active ? "var(--hover)" : "transparent" }}
      >
        <Icon name={expanded ? "ph-caret-down" : "ph-caret-right"} size={11} color="var(--faint)" style={{ width: 11 }} />
        <StatusDot state={st?.state} />
        <span className="ellipsis" style={{ flex: 1, fontSize: 12.5, color: st?.state && st.state !== "disconnected" ? "var(--text)" : "var(--muted)", fontWeight: active ? 600 : 400 }}>{conn.name}</span>
        {hover ? (
          <span style={{ display: "flex" }} role="presentation" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn sm" style={{ width: 22, height: 22, fontSize: 13 }} title="Edit" onClick={() => setOverlay({ kind: "connection", connId: conn.id })}><Icon name="ph-pencil-simple" /></button>
            {connected || st?.state === "error" ? (
              <button className="icon-btn sm" style={{ width: 22, height: 22, fontSize: 13 }} title="Disconnect" onClick={() => void disconnect(conn.id)}><Icon name="ph-plugs" /></button>
            ) : (
              <button className="icon-btn sm" style={{ width: 22, height: 22, fontSize: 13 }} title="Connect" onClick={() => void connect(conn.id)}><Icon name="ph-plugs-connected" /></button>
            )}
          </span>
        ) : (
          conn.tls.enabled && <Icon name="ph-lock-simple" size={13} color="var(--muted)" />
        )}
      </div>
      {st?.state === "error" && st.error && (
        <div className="mono ellipsis" style={{ padding: "0 12px 5px 57px", fontSize: 10.5, color: "var(--err)" }}>{short(st.error)}</div>
      )}
      {expanded && (
        <>
          <div
            {...press(() => openQueues(conn.id))}
            className="hoverable"
            style={{ height: 26, display: "flex", alignItems: "center", gap: 7, padding: "0 12px 0 42px", cursor: "pointer", background: tab?.kind === "queues" && tab.connId === conn.id ? "var(--sel)" : "transparent" }}
          >
            <Icon name="ph-caret-down" size={11} color="var(--faint)" />
            <Icon name="ph-hard-drives" size={14} color="var(--muted)" />
            <span className="mono ellipsis" style={{ fontSize: 12 }}>{st?.info?.qmgr ?? conn.qmgr}</span>
            <span className="mono" style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--faint)" }}>{st?.info?.version}</span>
          </div>
          {st?.queuesError && (
            <div style={{ padding: "2px 12px 4px 74px", fontSize: 11, color: "var(--faint)" }}>Queue list unavailable ({short(st.queuesError)})</div>
          )}
          {st?.queuesSource === "probe" && queues.length === 0 && (
            <div {...press(() => openQueues(conn.id))} style={{ padding: "2px 12px 4px 74px", fontSize: 11, color: "var(--faint)", cursor: "pointer" }}>Add queues by name…</div>
          )}
          {queues.slice(0, TREE_QUEUES).map((q) => {
            const sel = tab?.kind === "browse" && tab.connId === conn.id && tab.queue === q.name;
            return (
              <div
                key={q.name}
                {...press(() => (q.access && !q.access.browse ? setOverlay({ kind: "put", connId: conn.id, queue: q.name }) : openBrowse(conn.id, q.name)))}
                className="hoverable"
                style={{ height: 25, display: "flex", alignItems: "center", gap: 7, padding: "0 12px 0 74px", cursor: "pointer", background: sel ? "var(--sel)" : "transparent", color: sel ? "var(--accent)" : "var(--text)" }}
              >
                <Icon name="ph-tray" size={13} color="var(--faint)" />
                <span className="mono ellipsis" style={{ flex: 1, fontSize: 11.5 }}>{q.name}</span>
                <span className="mono" style={{ fontSize: 11, color: depthColor(q) }}>{q.depth == null ? "—" : n(q.depth)}</span>
              </div>
            );
          })}
          {queues.length > TREE_QUEUES && (
            <div {...press(() => openQueues(conn.id))} style={{ height: 24, display: "flex", alignItems: "center", padding: "0 12px 0 94px", fontSize: 11.5, color: "var(--faint)", cursor: "pointer" }}>
              {queues.length - TREE_QUEUES} more queues…
            </div>
          )}
        </>
      )}
    </div>
  );
}
