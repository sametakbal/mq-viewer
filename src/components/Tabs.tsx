import { useEffect, useRef, useState } from "react";
import { useApp } from "../state";
import { n } from "../lib/format";
import { Icon, press } from "./ui";

type Menu = { tabId: string; x: number; y: number };

export default function Tabs() {
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.activeTab);
  const connections = useApp((s) => s.connections);
  const status = useApp((s) => s.status);
  const browse = useApp((s) => s.browse);
  const { activate, closeTab, setOverlay } = useApp.getState();
  const multiConn = new Set(tabs.map((t) => t.connId)).size > 1;
  const [menu, setMenu] = useState<Menu | null>(null);

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
            onContextMenu={(e) => { e.preventDefault(); setMenu({ tabId: t.id, x: e.clientX, y: e.clientY }); }}
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
      {menu && <TabMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Right-click menu of a tab, fixed at the pointer so the tab strip's horizontal scroll does not clip it. */
function TabMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const tabs = useApp((s) => s.tabs);
  const { closeTabs } = useApp.getState();
  const ref = useRef<HTMLDivElement>(null);
  const idx = tabs.findIndex((t) => t.id === menu.tabId);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (idx < 0) return null;
  const ids = (list: typeof tabs) => list.map((t) => t.id);
  const items = [
    { label: "Close", icon: "ph-x", hint: "Middle-click", close: [menu.tabId] },
    { label: "Close others", icon: "ph-x-square", close: ids(tabs.filter((t) => t.id !== menu.tabId)) },
    { label: "Close tabs to the left", icon: "ph-arrow-line-left", close: ids(tabs.slice(0, idx)) },
    { label: "Close tabs to the right", icon: "ph-arrow-line-right", close: ids(tabs.slice(idx + 1)) },
    { label: "Close all", icon: "ph-x-circle", close: ids(tabs) },
  ];

  return (
    <div ref={ref} role="menu" className="popover" style={{ position: "fixed", left: Math.min(menu.x, window.innerWidth - 236), top: menu.y, width: 220, display: "flex", flexDirection: "column", gap: 1 }}>
      {items.map((it, i) => {
        const disabled = it.close.length === 0;
        return (
          <div key={it.label}>
            {i === 2 || i === 4 ? <div style={{ height: 1, background: "var(--line)", margin: "4px 2px" }} /> : null}
            <div
              className="menu-item"
              aria-disabled={disabled}
              style={disabled ? { opacity: 0.4, cursor: "default", pointerEvents: "none" } : undefined}
              {...press(() => { closeTabs(it.close); onClose(); }, "menuitem")}
            >
              <Icon name={it.icon} color="var(--muted)" />
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.hint && <span style={{ fontSize: 11, color: "var(--faint)" }}>{it.hint}</span>}
              {!it.hint && it.close.length > 0 &&<span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{it.close.length}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
