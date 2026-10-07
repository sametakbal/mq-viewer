import { useEffect, useState } from "react";
import { useApp } from "../state";
import { draftConnId, sendDraft } from "../lib/drafts";
import type { Template } from "../lib/types";
import { Icon, press, Spinner } from "./ui";

/** Sidebar list of saved sample messages; each one goes to its queue in one click. */
export default function Drafts() {
  const drafts = useApp((s) => s.templates);
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const shown = [...drafts]
    .filter((t) => !f || `${t.name} ${t.queue ?? ""}`.toLowerCase().includes(f))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ flex: "none", maxHeight: "42%", display: "flex", flexDirection: "column", borderTop: "1px solid var(--line)" }}>
      <div style={{ height: 34, flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "0 8px 0 14px", cursor: "pointer", userSelect: "none" }} {...press(() => setOpen(!open))} aria-expanded={open}>
        <Icon name={open ? "ph-caret-down" : "ph-caret-right"} size={11} color="var(--faint)" />
        <span className="caps" style={{ flex: 1 }}>DRAFTS</span>
        <span style={{ fontSize: 11, color: "var(--faint)", marginRight: 4 }}>{drafts.length || ""}</span>
        <NewDraftButton />
      </div>
      {open && (
        <div style={{ minHeight: 0, overflow: "auto", paddingBottom: 6 }}>
          {drafts.length > 6 && (
            <div style={{ padding: "0 10px 6px" }}>
              <div className="input" style={{ height: 26, fontSize: 12, padding: "0 9px", gap: 7 }}>
                <Icon name="ph-magnifying-glass" size={12} color="var(--faint)" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter drafts" spellCheck={false} />
              </div>
            </div>
          )}
          {drafts.length === 0 && (
            <div style={{ padding: "2px 14px 10px", fontSize: 11.5, color: "var(--faint)", lineHeight: 1.45, textWrap: "pretty" }}>
              Prepare sample messages in Put message and choose <span style={{ color: "var(--muted)" }}>Save as draft</span> — they show up here and go to their queue in one click.
            </div>
          )}
          {shown.map((t) => <DraftRow key={t.name} t={t} />)}
        </div>
      )}
    </div>
  );
}

function NewDraftButton() {
  const focus = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.connId ?? s.focusConn);
  const queue = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.queue ?? "");
  const setOverlay = useApp((s) => s.setOverlay);
  return (
    <button
      className="icon-btn sm"
      title="New draft"
      disabled={!focus}
      onClick={(e) => { e.stopPropagation(); if (focus) setOverlay({ kind: "put", connId: focus, queue }); }}
    >
      <Icon name="ph-plus" />
    </button>
  );
}

function DraftRow({ t }: { t: Template }) {
  const connId = draftConnId(t);
  const conn = useApp((s) => s.connections.find((c) => c.id === connId));
  const { setOverlay, saveTemplates } = useApp.getState();
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"send" | "delete" | null>(null);
  const prod = conn?.env === "PROD";

  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(null), 3000);
    return () => clearTimeout(timer);
  }, [confirm]);

  const send = async () => {
    if (prod && confirm !== "send") return setConfirm("send");
    setConfirm(null);
    setBusy(true);
    await sendDraft(t);
    setBusy(false);
  };
  const remove = async () => {
    if (confirm !== "delete") return setConfirm("delete");
    await saveTemplates(useApp.getState().templates.filter((x) => x.name !== t.name));
  };
  const edit = () => connId && setOverlay({ kind: "put", connId, queue: t.queue ?? "", draftName: t.name });

  return (
    <div
      className="hoverable"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setConfirm(null); }}
      {...press(edit)}
      title={`${t.name}${t.queue ? ` → ${t.queue}` : ""}${conn ? ` on ${conn.name}` : ""}${t.count && t.count > 1 ? ` · ×${t.count}` : ""}`}
      style={{ minHeight: 34, display: "flex", alignItems: "center", gap: 8, padding: "3px 8px 3px 14px", cursor: "pointer" }}
    >
      <Icon name="ph-note-pencil" size={14} color="var(--faint)" />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span className="ellipsis" style={{ fontSize: 12.5 }}>{t.name}</span>
        <span className="mono ellipsis" style={{ fontSize: 10.5, color: t.queue ? "var(--muted)" : "var(--faint)" }}>
          {t.queue ? `→ ${t.queue}` : "no queue — opens Put"}
          {t.count && t.count > 1 ? ` ×${t.count}` : ""}
          {conn ? <span style={{ color: prod ? "var(--err)" : "var(--faint)" }}> · {conn.name}</span> : null}
        </span>
      </div>
      {confirm ? (
        <button
          className={`btn xs ${confirm === "delete" ? "danger" : "prod"}`}
          onClick={(e) => { e.stopPropagation(); void (confirm === "send" ? send() : remove()); }}
        >
          {confirm === "send" ? "Send to PROD?" : "Delete?"}
        </button>
      ) : busy ? (
        <Spinner />
      ) : hover ? (
        <span style={{ display: "flex" }} role="presentation" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn sm" style={{ width: 22, height: 22, fontSize: 13 }} title="Delete draft" onClick={() => void remove()}><Icon name="ph-trash" /></button>
          <button className="icon-btn sm" style={{ width: 22, height: 22, fontSize: 13 }} title="Edit in Put message" onClick={edit}><Icon name="ph-pencil-simple" /></button>
          <button
            className="icon-btn sm"
            style={{ width: 22, height: 22, fontSize: 13, color: "var(--accent)" }}
            title={t.queue ? `Send to ${t.queue}` : "Choose a queue"}
            onClick={() => void send()}
          >
            <Icon name="ph-paper-plane-tilt" />
          </button>
        </span>
      ) : null}
    </div>
  );
}
