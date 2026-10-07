import { useApp } from "../state";
import { n } from "../lib/format";
import { Icon, press } from "./ui";

export default function Tabs() {
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.activeTab);
  const connections = useApp((s) => s.connections);
  const status = useApp((s) => s.status);
  const browse = useApp((s) => s.browse);
  const { activate, closeTab, setOverlay } = useApp.getState();
  const multiConn = new Set(tabs.map((t) => t.connId)).size > 1;

  return (
    <div style={{ height: 36, flex: "none", display: "flex", alignItems: "stretch", background: "var(--panel)", borderBottom: "1px solid var(--line)", overflowX: "auto", overflowY: "hidden" }}>
      {tabs.map((t) => {
        const on = t.id === active;
        const conn = connections.find((c) => c.id === t.connId);
        const label = t.kind === "queues" ? status[t.connId]?.info?.qmgr ?? conn?.qmgr ?? "QM" : t.queue!;
        const b = browse[t.id];
        const meta = t.kind === "queues" ? "Queues" : b && !b.loading && !b.error && b.depth >= 0 ? n(b.depth) : "";
        return (
          <div
            key={t.id}
            {...press(() => activate(t.id), "tab")} aria-selected={t.id === active}
            onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
            title={conn ? `${conn.name} · ${label}` : label}
            style={{ position: "relative", display: "flex", alignItems: "center", gap: 7, padding: "0 6px 0 14px", borderRight: "1px solid var(--line)", background: on ? "var(--bg)" : "transparent", color: on ? "var(--text)" : "var(--muted)", cursor: "pointer", fontSize: 12.5, flex: "none" }}
          >
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: on ? "var(--accent)" : "transparent" }} />
            <Icon name={t.kind === "queues" ? "ph-hard-drives" : "ph-eye"} size={14} />
            {multiConn && conn && <span style={{ fontSize: 11, color: "var(--faint)" }}>{conn.name} ›</span>}
            <span className="mono" style={{ fontSize: 12 }}>{label}</span>
            <span style={{ fontSize: 11, color: "var(--faint)" }}>{meta}</span>
            <button className="icon-btn sm" style={{ width: 20, height: 20, fontSize: 11, marginLeft: 2 }} title="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>
              <Icon name="ph-x" />
            </button>
          </div>
        );
      })}
      <button className="icon-btn" title="Open queue… (Ctrl K)" style={{ width: 36, height: "100%", borderRadius: 0, fontSize: 14, color: "var(--faint)" }} onClick={() => setOverlay({ kind: "palette" })}>
        <Icon name="ph-plus" />
      </button>
    </div>
  );
}
