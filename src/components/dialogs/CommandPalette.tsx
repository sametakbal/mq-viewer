import { useMemo, useState } from "react";
import { useApp } from "../../state";
import { n } from "../../lib/format";
import { Icon, StatusDot } from "../ui";
import { draftConnId, sendDraft } from "../../lib/drafts";

interface Item {
  key: string;
  icon: string;
  label: string;
  meta: string;
  run: () => void;
}

/** Ctrl+K: jump to queues of connected queue managers, connections, or loaded messages by MsgId/CorrelId. */
export default function CommandPalette() {
  const connections = useApp((s) => s.connections);
  const status = useApp((s) => s.status);
  const tabs = useApp((s) => s.tabs);
  const browse = useApp((s) => s.browse);
  const drafts = useApp((s) => s.templates);
  const { openBrowse, openQueues, setOverlay, patchBrowse, activate } = useApp.getState();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const items = useMemo(() => {
    const query = q.trim().toUpperCase();
    const out: Item[] = [];
    const close = (fn: () => void) => () => {
      setOverlay(null);
      fn();
    };
    for (const t of drafts) {
      if (!t.queue || (query && !t.name.toUpperCase().includes(query) && !t.queue.includes(query))) continue;
      // PROD targets open in Put message instead of sending straight away.
      const cid = draftConnId(t);
      const prod = connections.find((c) => c.id === cid)?.env === "PROD";
      out.push({
        key: `draft/${t.name}`, icon: prod ? "ph-note-pencil" : "ph-paper-plane-tilt", label: prod ? `Open draft ${t.name}` : `Send draft ${t.name}`, meta: `→ ${t.queue}${prod ? " · PROD" : ""}`,
        run: close(() => (prod && cid ? setOverlay({ kind: "put", connId: cid, queue: t.queue!, draftName: t.name }) : void sendDraft(t))),
      });
    }
    for (const c of connections) {
      const st = status[c.id];
      for (const qi of st?.queues ?? []) {
        if (qi.type === "Model" || (qi.name.startsWith("SYSTEM.") && !query.startsWith("SYSTEM"))) continue;
        if (query && !qi.name.includes(query)) continue;
        out.push({ key: `${c.id}/${qi.name}`, icon: "ph-tray", label: qi.name, meta: `${c.name}${qi.depth != null ? ` · ${n(qi.depth)}` : ` · ${qi.type}`}`, run: close(() => openBrowse(c.id, qi.name)) });
      }
      if (!query || c.name.toUpperCase().includes(query) || c.qmgr.toUpperCase().includes(query)) {
        out.push({ key: c.id, icon: "ph-hard-drives", label: c.name, meta: `${c.qmgr} · ${c.host}:${c.port}`, run: close(() => openQueues(c.id)) });
      }
      // Exact queue names typed by hand, for users without PCF access to list queues.
      if (query.includes(".") && st?.state === "connected" && !(st.queues ?? []).some((x) => x.name === query) && /^[A-Z0-9._/%]+$/.test(query)) {
        out.push({ key: `${c.id}/open/${query}`, icon: "ph-eye", label: `Browse ${query}`, meta: c.name, run: close(() => openBrowse(c.id, query)) });
      }
    }
    if (query.length >= 6) {
      for (const t of tabs) {
        for (const m of browse[t.id]?.messages ?? []) {
          if (m.msgId.includes(query) || m.correlId.includes(query)) {
            out.push({
              key: `${t.id}/${m.msgId}`, icon: "ph-envelope-simple", label: m.msgId, meta: `#${m.seq} in ${t.queue}`,
              run: close(() => { activate(t.id); patchBrowse(t.id, { selected: m.msgId, detailClosed: false, search: "" }); }),
            });
          }
        }
      }
    }
    return out.slice(0, 60);
  }, [q, drafts, connections, status, tabs, browse, openBrowse, openQueues, setOverlay, patchBrowse, activate]);

  const sel = Math.min(idx, items.length - 1);

  return (
    <div className="modal" style={{ top: 90, width: 620 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: 50, borderBottom: "1px solid var(--line)" }}>
        <Icon name="ph-magnifying-glass" size={18} color="var(--muted)" />
        <input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter" && items[sel]) items[sel].run();
          }}
          placeholder="Queue name, connection, MsgId or CorrelId…"
          spellCheck={false}
          style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 14 }}
        />
        <span className="kbd" style={{ color: "var(--faint)" }}>Esc</span>
      </div>
      <div style={{ maxHeight: 420, overflow: "auto", padding: 6 }}>
        {items.length === 0 && (
          <div style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>
            {connections.some((c) => status[c.id]?.state === "connected") ? "No matches." : "Connect to a queue manager to search its queues."}
          </div>
        )}
        {items.map((it, i) => (
          <div key={it.key} className={`menu-item${i === sel ? " active" : ""}`} onMouseEnter={() => setIdx(i)} onClick={it.run} style={{ height: 32 }}>
            <Icon name={it.icon} size={15} color="var(--muted)" />
            <span className="mono ellipsis" style={{ fontSize: 12.5 }}>{it.label}</span>
            <span className="ellipsis" style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--faint)" }}>{it.meta}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, padding: "8px 16px", borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--faint)" }}>
        {connections.map((c) => status[c.id]?.state === "connected" && (
          <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 5 }}><StatusDot state="connected" size={6} />{c.name}</span>
        ))}
        <span style={{ marginLeft: "auto" }}>↑↓ to move · Enter to open</span>
      </div>
    </div>
  );
}
