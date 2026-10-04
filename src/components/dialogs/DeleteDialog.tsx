import { useState } from "react";
import { connOf, useApp, type Overlay } from "../../state";
import { api, asMqError } from "../../lib/rpc";
import { n, timeOf } from "../../lib/format";
import { exportMessages } from "../../lib/transfer";
import type { Message } from "../../lib/types";
import { Icon, Spinner } from "../ui";

const NONE: Message[] = [];

export default function DeleteDialog({ overlay }: { overlay: Extract<Overlay, { kind: "delete" }> }) {
  const conn = useApp((s) => connOf(s, overlay.connId));
  const tab = useApp((s) => s.tabs.find((t) => t.kind === "browse" && t.connId === overlay.connId && t.queue === overlay.queue));
  const loaded = useApp((s) => (tab ? s.browse[tab.id]?.messages : undefined)) ?? NONE;
  const { setOverlay, showToast, refreshBrowse, patchBrowse, loadQueues } = useApp.getState();
  const [busy, setBusy] = useState(false);

  if (!conn) return null;
  const ids = overlay.msgIds;
  const items = ids.map((id) => loaded.find((m) => m.msgId === id) ?? { msgId: id, seq: 0, putTime: null });
  const label = `${n(ids.length)} message${ids.length === 1 ? "" : "s"}`;

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.deleteMessages(conn.id, overlay.queue, ids);
      setOverlay(null);
      showToast({
        tone: r.notFound.length ? "err" : "ok",
        title: `Deleted ${n(r.deleted)} message${r.deleted === 1 ? "" : "s"}`,
        sub: `from ${overlay.queue} · depth now ${n(r.depth)}${r.notFound.length ? ` · ${r.notFound.length} already gone` : ""}`,
      });
      if (tab) {
        patchBrowse(tab.id, (b) => ({ checked: Object.fromEntries(Object.keys(b.checked).filter((k) => !ids.includes(k)).map((k) => [k, true as const])) }));
        void refreshBrowse(tab.id, "poll");
      }
      void loadQueues(conn.id);
    } catch (e) {
      const err = asMqError(e);
      showToast({ tone: "err", title: "Delete failed — nothing was removed", sub: `${err.code ? `MQRC ${err.code} ` : ""}${err.name}` });
      setBusy(false);
    }
  };

  return (
    <div className="modal" style={{ top: 180, width: 560 }}>
      <div style={{ padding: "20px 22px 0", display: "flex", gap: 14 }}>
        <div style={{ width: 40, height: 40, flex: "none", borderRadius: 9, background: "var(--err-bg)", border: "1px solid var(--err-line)", color: "var(--err)", display: "grid", placeItems: "center", fontSize: 20 }}>
          <Icon name="ph-trash" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Delete {label}?</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
            Removed from <span className="mono" style={{ color: "var(--text)" }}>{overlay.queue}</span> by destructive get matching each MsgId. This cannot be undone.
          </div>
        </div>
      </div>
      <div style={{ margin: "16px 22px 0", border: "1px solid var(--line)", borderRadius: 6, overflow: "auto", maxHeight: 220 }}>
        {items.map((m) => (
          <div key={m.msgId} className="mono" style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 96px", gap: 8, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--line-soft)", fontSize: 11.5 }}>
            <span style={{ color: "var(--faint)" }}>{m.seq ? `#${m.seq}` : ""}</span>
            <span className="ellipsis">{m.msgId}</span>
            <span style={{ color: "var(--muted)", textAlign: "right" }}>{timeOf(m.putTime)}</span>
          </div>
        ))}
      </div>
      {conn.env === "PROD" && (
        <div style={{ margin: "12px 22px 0", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--err)" }}>
          <Icon name="ph-warning" />PROD connection — {conn.name}
        </div>
      )}
      <div className="modal-foot" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={() => void exportMessages(overlay.queue, loaded.filter((m) => ids.includes(m.msgId)))}>
          <Icon name="ph-export" />Export before delete
        </button>
        <div className="spacer" />
        <button className="btn lg" style={{ background: "var(--panel)" }} onClick={() => setOverlay(null)}>Cancel</button>
        <button className="btn prod lg" autoFocus onClick={() => void run()} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="ph-trash" />}Delete {label}
        </button>
      </div>
    </div>
  );
}
