import { useState } from "react";
import { connOf, useApp, type Overlay } from "../../state";
import { api, asMqError } from "../../lib/rpc";
import { clock, n } from "../../lib/format";
import { exportMessages } from "../../lib/transfer";
import { Icon, Spinner } from "../ui";

const EXPORT_MAX = 5000;

export default function PurgeDialog({ overlay }: { overlay: Extract<Overlay, { kind: "purge" }> }) {
  const conn = useApp((s) => connOf(s, overlay.connId));
  const st = useApp((s) => s.status[overlay.connId]);
  const tab = useApp((s) => s.tabs.find((t) => t.kind === "browse" && t.connId === overlay.connId && t.queue === overlay.queue));
  const depthFromTab = useApp((s) => (tab ? s.browse[tab.id]?.depth : undefined));
  const info = st?.queues?.find((q) => q.name === overlay.queue);
  const { setOverlay, showToast, refreshBrowse, loadQueues } = useApp.getState();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"purge" | "export" | null>(null);

  if (!conn) return null;
  const q = overlay.queue;
  const ok = text === q;
  const prod = conn.env === "PROD";
  const depth = depthFromTab ?? info?.depth ?? null;
  const handles = info?.ipprocs ?? 0;

  const exportFirst = async () => {
    setBusy("export");
    try {
      const r = await api.browse(conn.id, q, 0, EXPORT_MAX);
      await exportMessages(q, r.messages);
    } catch (e) {
      showToast({ tone: "err", title: "Export failed", sub: asMqError(e).name });
    } finally {
      setBusy(null);
    }
  };

  const purge = async () => {
    if (!ok) return;
    setBusy("purge");
    try {
      const r = await api.purge(conn.id, q);
      setOverlay(null);
      showToast({ tone: "ok", title: `Purged ${q}`, sub: `${r.removed >= 0 ? `${n(r.removed)} messages removed · ` : ""}${r.method} · ${clock()}` });
      if (tab) void refreshBrowse(tab.id, "reset");
      void loadQueues(conn.id);
    } catch (e) {
      const err = asMqError(e);
      showToast({ tone: "err", title: `Purge of ${q} failed`, sub: `${err.code ? `MQRC ${err.code} ` : ""}${err.name}` });
      setBusy(null);
    }
  };

  return (
    <div className="modal" style={{ top: 170, width: 560, borderColor: "var(--err-line)" }}>
      <div style={{ height: 5, background: "repeating-linear-gradient(-45deg,var(--prod) 0 10px,transparent 10px 20px)" }} />
      <div style={{ padding: "20px 22px 0", display: "flex", gap: 14 }}>
        <div style={{ width: 40, height: 40, flex: "none", borderRadius: 9, background: "var(--err-bg)", border: "1px solid var(--err-line)", color: "var(--err)", display: "grid", placeItems: "center", fontSize: 22 }}>
          <Icon name="ph-warning-octagon" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Purge queue <span className="mono">{q}</span>?</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.5, textWrap: "pretty" }}>
            All <b style={{ color: "var(--text)" }}>{depth != null ? `${n(depth)} messages` : "messages"}</b> will be permanently removed with CLEAR QLOCAL. This cannot be undone — browsed copies are not kept.
          </div>
        </div>
      </div>
      {prod && (
        <div style={{ margin: "16px 22px 0", padding: "11px 13px", borderRadius: 6, background: "var(--prod)", color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="ph-shield-warning" size={20} />
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4 }}>
            <b>Production connection.</b> {conn.name} · {st?.info?.qmgr ?? conn.qmgr}
            {handles > 0 ? ` · ${handles} active input handle${handles === 1 ? "" : "s"} will lose pending messages.` : ""}
          </div>
        </div>
      )}
      <div style={{ margin: "16px 22px 0", display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Type <b className="mono" style={{ color: "var(--text)" }}>{q}</b> to confirm</span>
        <input
          autoFocus
          className="input mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void purge()}
          spellCheck={false}
          placeholder={q}
          style={{ height: 34, fontSize: 13, borderColor: ok ? "var(--err)" : undefined, boxShadow: ok ? "0 0 0 3px var(--err-bg)" : undefined }}
        />
        <span style={{ fontSize: 11.5, color: ok ? "var(--err)" : "var(--faint)" }}>
          {ok ? "Name matches — purge is enabled." : text ? "Doesn’t match yet — names are case-sensitive." : "Purge stays disabled until the name matches exactly."}
        </span>
      </div>
      <div className="modal-foot" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={() => void exportFirst()} disabled={!!busy}>
          {busy === "export" ? <Spinner /> : <Icon name="ph-export" />}Export all first…
        </button>
        <div className="spacer" />
        <button className="btn lg" style={{ background: "var(--panel)" }} onClick={() => setOverlay(null)}>Cancel</button>
        <button className="btn prod lg" onClick={() => void purge()} disabled={!ok || !!busy}>
          {busy === "purge" ? <Spinner /> : <Icon name="ph-broom" />}Purge{depth != null ? ` ${n(depth)} messages` : ""}
        </button>
      </div>
    </div>
  );
}
