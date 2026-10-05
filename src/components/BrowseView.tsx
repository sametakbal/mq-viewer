import { useEffect, useMemo, useRef, useState } from "react";
import { connOf, emptyMqmd, queueAccess, useApp, type BrowseState, type PutDraft, type Tab } from "../state";
import { bytes, clock, copyText, correlShow, dateOf, idTail, isZeroId, matcher, n, timeOf } from "../lib/format";
import { exportMessages } from "../lib/transfer";
import { withControlPictures } from "../lib/control";
import type { Message } from "../lib/types";
import ErrorView from "./ErrorView";
import { Checkbox, Empty, Icon, Spinner, Switch } from "./ui";

export function visibleMessages(b: BrowseState): Message[] {
  const m = matcher(b.search, b.regex);
  const f = b.filters;
  return b.messages.filter((x) => {
    if (f.format && (x.format || "NONE") !== f.format) return false;
    if (f.kind && x.kind !== f.kind) return false;
    if (f.correlOnly && isZeroId(x.correlId)) return false;
    if (m && !m(x.text ?? "") && !m(x.msgId) && !m(x.correlId)) return false;
    return true;
  });
}

/** Draft for "Copy & resend": same body, MQMD options and user properties, new MsgId. */
export function resendDraft(m: Message, ccsid: number): Partial<PutDraft> {
  const md = Object.fromEntries(m.mqmd.map((f) => [f.k, f.v]));
  return {
    body: m.text ?? "",
    bodyBase64: m.text == null ? m.base64 : undefined,
    fileName: m.text == null ? `${m.msgId.slice(-16)}.bin` : undefined,
    mqmd: {
      ...emptyMqmd(m.ccsid || ccsid), format: m.format || "NONE", priority: m.priority,
      persistence: m.persistence === 1 ? "P" : "NP", correlId: isZeroId(m.correlId) ? "" : m.correlId,
      replyToQ: md.ReplyToQ ?? "", replyToQmgr: md.ReplyToQMgr ?? "",
    },
    properties: m.props.filter((p) => !/^(jms|mcd|JMS)/.test(p.k)).map((p) => ({ name: p.k, type: p.t === "Null" ? "String" : p.t, value: p.v })),
  };
}

export const NO_PUT = "You have no put authority on this queue";
export const NO_GET = "You have no get authority on this queue";

const GRID = "34px 46px 170px 112px 112px 62px 62px 34px 38px minmax(0,1fr)";

export default function BrowseView({ tab }: { tab: Tab }) {
  const b = useApp((s) => s.browse[tab.id]);
  const conn = useApp((s) => connOf(s, tab.connId));
  const limit = useApp((s) => s.settings.browseLimit);
  const interval = useApp((s) => s.settings.refreshInterval);
  const defaultCcsid = useApp((s) => s.settings.defaultCcsid);
  const showCtl = useApp((s) => s.settings.showControlChars);
  const access = useApp((s) => queueAccess(s, tab.connId, tab.queue ?? ""));
  const canPut = access?.put ?? true;
  const canGet = access?.get ?? true;
  const { patchBrowse, refreshBrowse, setOverlay } = useApp.getState();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-refresh: re-browse the loaded window and flag MsgIds that were not there before.
  useEffect(() => {
    if (!b?.auto || !interval) return;
    const t = setInterval(() => void refreshBrowse(tab.id, "poll"), interval * 1000);
    return () => clearInterval(t);
  }, [b?.auto, interval, tab.id, refreshBrowse]);

  const visible = useMemo(() => (b ? visibleMessages(b) : []), [b]);

  // ↑/↓ moves the selection, space toggles the checkbox.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!b || useApp.getState().overlay) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      const i = visible.findIndex((m) => m.msgId === b.selected);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) {
          patchBrowse(tab.id, { selected: next.msgId, detailClosed: false });
          listRef.current?.querySelector(`[data-id="${next.msgId}"]`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === " " && b.selected) {
        e.preventDefault();
        const id = b.selected;
        patchBrowse(tab.id, (cur) => {
          const checked = { ...cur.checked };
          if (checked[id]) delete checked[id];
          else checked[id] = true;
          return { checked };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!b || !conn) return null;
  const queue = tab.queue!;

  const checkedIds = Object.keys(b.checked);
  const nChecked = checkedIds.length;
  const allVisibleChecked = visible.length > 0 && visible.every((m) => b.checked[m.msgId]);
  const toggleCheck = (id: string) =>
    patchBrowse(tab.id, (cur) => {
      const checked = { ...cur.checked };
      if (checked[id]) delete checked[id];
      else checked[id] = true;
      return { checked };
    });
  const toggleAll = () =>
    patchBrowse(tab.id, (cur) => {
      if (allVisibleChecked) {
        const checked = { ...cur.checked };
        for (const m of visible) delete checked[m.msgId];
        return { checked };
      }
      const checked = { ...cur.checked };
      for (const m of visible) checked[m.msgId] = true;
      return { checked };
    });
  const checkedMsgs = b.messages.filter((m) => b.checked[m.msgId]);
  const activeFilters = (b.filters.format ? 1 : 0) + (b.filters.kind ? 1 : 0) + (b.filters.correlOnly ? 1 : 0);

  if (b.error && !b.messages.length) return <ErrorView connId={tab.connId} error={b.error} onRetry={() => void refreshBrowse(tab.id, "reset")} queue={queue} />;

  const isEmpty = !b.loading && b.messages.length === 0;
  const putDate = b.messages[0]?.putTime ? dateOf(b.messages[0].putTime) : "";

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ height: 34, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 14px", background: "var(--accent-bg)", borderBottom: "1px solid var(--accent-line)" }}>
        <span className="mono" style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, height: 20, padding: "0 8px", borderRadius: 4, background: "var(--accent)", color: "var(--accent-ink)", fontSize: 10.5, fontWeight: 600, letterSpacing: ".06em" }}>
          <Icon name="ph-eye" size={13} />BROWSE MODE
        </span>
        <span className="ellipsis" style={{ flex: 1, fontSize: 12.5 }}>Read-only — browsing never removes messages</span>
        <span className="mono" style={{ flex: "none", fontSize: 11.5, color: "var(--muted)" }}>
          {queue} · {b.depth >= 0 ? n(b.depth) : "?"}{b.maxDepth > 0 ? ` / ${n(b.maxDepth)}` : ""}
        </span>
        <div style={{ width: 1, height: 16, background: "var(--accent-line)" }} />
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: interval ? "pointer" : "default", opacity: interval ? 1 : 0.5 }}
          title={interval ? undefined : "Auto-refresh is off in Settings"}
          onClick={() => interval && patchBrowse(tab.id, { auto: !b.auto, pollErrors: 0 })}>
          <Switch on={b.auto && !!interval} onChange={(v) => interval && patchBrowse(tab.id, { auto: v, pollErrors: 0 })} />
          <span>Auto-refresh</span>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{interval ? `${interval}s` : "off"}</span>
        </div>
      </div>

      <div style={{ position: "relative", height: 44, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: "1px solid var(--line)" }}>
        <div className="input on-panel" style={{ width: 250, padding: "0 6px 0 9px", gap: 7, fontSize: 12 }}>
          <Icon name="ph-magnifying-glass" size={14} color="var(--faint)" />
          <input value={b.search} onChange={(e) => patchBrowse(tab.id, { search: e.target.value })} placeholder="Search in payloads…" spellCheck={false} />
          <span
            className="mono"
            title="Regular expression"
            onClick={() => patchBrowse(tab.id, { regex: !b.regex })}
            style={{ fontSize: 10, padding: "1px 4px", border: `1px solid ${b.regex ? "var(--accent)" : "var(--line2)"}`, color: b.regex ? "var(--accent)" : "var(--faint)", borderRadius: 3, cursor: "pointer" }}
          >.*</span>
        </div>
        <button className="btn outline" style={{ fontWeight: 400, fontSize: 12, padding: "0 10px", borderColor: activeFilters ? "var(--accent-line)" : undefined }} onClick={() => setFiltersOpen((v) => !v)}>
          <Icon name="ph-funnel-simple" size={14} color="var(--muted)" />Filters
          {activeFilters > 0 && <span className="mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>{activeFilters}</span>}
        </button>
        {filtersOpen && <FiltersPopover tab={tab} b={b} onClose={() => setFiltersOpen(false)} />}
        <div className="spacer" />
        <span style={{ fontSize: 12, color: nChecked ? "var(--text)" : "var(--faint)" }}>{nChecked ? `${nChecked} selected` : "No selection"}</span>
        <div style={{ display: "flex", gap: 2, opacity: nChecked ? 1 : 0.4, pointerEvents: nChecked ? "auto" : "none" }}>
          <button className="icon-btn" title="Copy MsgIds" onClick={() => { void copyText(checkedIds.join("\n")); useApp.getState().showToast({ tone: "ok", title: `Copied ${nChecked} MsgId${nChecked === 1 ? "" : "s"}` }); }}><Icon name="ph-copy" /></button>
          <button className="icon-btn" title="Export selected" onClick={() => void exportMessages(queue, checkedMsgs)}><Icon name="ph-export" /></button>
          <button className="btn ghost" style={{ color: "var(--text)", fontWeight: 400, fontSize: 12, padding: "0 9px" }} disabled={!canPut} title={canPut ? undefined : NO_PUT} onClick={() => checkedMsgs[0] && setOverlay({ kind: "put", connId: conn.id, queue, draft: resendDraft(checkedMsgs[0], defaultCcsid) })}>
            <Icon name="ph-repeat" color="var(--muted)" />Copy &amp; resend
          </button>
          <button className="btn danger-ghost" style={{ fontWeight: 400, fontSize: 12, padding: "0 9px" }} disabled={!canGet} title={canGet ? undefined : NO_GET} onClick={() => setOverlay({ kind: "delete", connId: conn.id, queue, msgIds: checkedIds })}>
            <Icon name="ph-trash" />Delete
          </button>
        </div>
        <div className="vsep" />
        <button className="btn danger" style={{ fontWeight: 400, fontSize: 12, padding: "0 10px" }} onClick={() => setOverlay({ kind: "purge", connId: conn.id, queue })} disabled={b.depth === 0 || !canGet} title={canGet ? undefined : NO_GET}>
          <Icon name="ph-broom" />Purge
        </button>
      </div>

      <div className="msg-grid col-head" style={{ height: 30, flex: "none", borderBottom: "1px solid var(--line)", background: "var(--panel)", gridTemplateColumns: GRID }}>
        <span style={{ display: "grid", placeItems: "center", cursor: "pointer", height: "100%" }} onClick={toggleAll}>
          <Checkbox on={allVisibleChecked} mixed={!allVisibleChecked && visible.some((m) => b.checked[m.msgId])} />
        </span>
        <span style={{ textAlign: "right", paddingRight: 10, color: "var(--text)" }}># ↑</span>
        <span>MESSAGE ID</span>
        <span>CORREL ID</span>
        <span>PUT{putDate ? ` · ${putDate}` : ""}</span>
        <span>FORMAT</span>
        <span style={{ textAlign: "right", paddingRight: 10 }}>SIZE</span>
        <span>PRI</span>
        <span>PERS</span>
        <span>PAYLOAD</span>
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {b.loading && <Skeleton />}
        {isEmpty && (
          <Empty
            icon="ph-tray"
            title={`${queue} is empty`}
            actions={
              <>
                <button className="btn primary" disabled={!canPut} title={canPut ? undefined : NO_PUT} onClick={() => setOverlay({ kind: "put", connId: conn.id, queue })}><Icon name="ph-paper-plane-tilt" />Put message</button>
                <button className="btn" onClick={() => void refreshBrowse(tab.id, "reset")}><Icon name="ph-arrows-clockwise" />Refresh now</button>
              </>
            }
          >
            Current depth 0 at {clock(b.browsedAt)}.{" "}
            {b.auto && interval ? "Auto-refresh is on — new messages will show up here without being consumed." : "Turn on auto-refresh to watch for new messages without consuming them."}
          </Empty>
        )}
        {!b.loading && !isEmpty && visible.length === 0 && (
          <Empty icon="ph-funnel-simple" title="No messages match">
            {b.messages.length} loaded message{b.messages.length === 1 ? "" : "s"} hidden by the search or filters.
          </Empty>
        )}
        {!b.loading && visible.map((m) => (
          <Row key={m.msgId} m={m} b={b} showCtl={showCtl} onSelect={() => patchBrowse(tab.id, { selected: m.msgId, detailClosed: false })} onCheck={() => toggleCheck(m.msgId)} />
        ))}
      </div>

      <div style={{ height: 36, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 14px", borderTop: "1px solid var(--line)", background: "var(--panel)", fontSize: 12, color: "var(--muted)" }}>
        {(b.loading || b.loadingMore) && <Spinner />}
        <span>
          {b.loading ? `Browsing first ${limit} messages of ${queue}…`
            : isEmpty ? "No messages"
            : `Showing 1–${n(b.messages.length)} of ${n(Math.max(b.depth, b.messages.length))}${visible.length !== b.messages.length ? ` · ${n(visible.length)} match` : ""}`}
        </span>
        {b.more && !b.loading && (
          <button className="btn xs" disabled={b.loadingMore} onClick={() => void refreshBrowse(tab.id, "more")}>Load {limit} more</button>
        )}
        {b.error && b.messages.length > 0 && <span style={{ color: "var(--err)" }}>{b.error.name}</span>}
        <div className="spacer" />
        <span>Browse limit {limit} · sorted by sequence</span>
      </div>
    </div>
  );
}

function Row({ m, b, showCtl, onSelect, onCheck }: { m: Message; b: BrowseState; showCtl: boolean; onSelect: () => void; onCheck: () => void }) {
  const sel = m.msgId === b.selected;
  const ck = !!b.checked[m.msgId];
  const corr = isZeroId(m.correlId);
  return (
    <div
      data-id={m.msgId}
      className={`msg-grid msg-row${b.fresh[m.msgId] ? " fresh" : ""}`}
      onClick={onSelect}
      style={{ gridTemplateColumns: GRID, background: sel ? "var(--sel)" : ck ? "var(--checked)" : undefined, boxShadow: `inset 2px 0 0 ${sel ? "var(--accent)" : b.fresh[m.msgId] ? "var(--ok)" : "transparent"}` }}
    >
      <div onClick={(e) => { e.stopPropagation(); onCheck(); }} style={{ display: "grid", placeItems: "center", height: "100%", cursor: "pointer" }}>
        <Checkbox on={ck} />
      </div>
      <span style={{ textAlign: "right", paddingRight: 10, color: "var(--faint)" }}>{m.seq}</span>
      <span className="ellipsis"><span style={{ color: "var(--faint)" }}>{m.msgId.slice(0, 6)}…</span><span style={{ color: sel ? "var(--accent)" : "var(--text)" }}>{idTail(m.msgId)}</span></span>
      <span className="ellipsis" style={{ color: corr ? "var(--faint)" : "var(--text)" }}>{corr ? "MQCI_NONE" : correlShow(m.correlId)}</span>
      <span style={{ color: "var(--muted)" }}>{timeOf(m.putTime)}</span>
      <span style={{ color: m.format === "MQHRF2" ? "var(--syn-key)" : m.format ? "var(--text)" : "var(--faint)" }}>{m.format || "NONE"}</span>
      <span style={{ textAlign: "right", paddingRight: 10, color: "var(--muted)" }}>{bytes(m.size)}</span>
      <span style={{ color: m.priority >= 7 ? "var(--warn)" : "var(--muted)" }}>{m.priority}</span>
      <span style={{ color: m.persistence === 1 ? "var(--muted)" : "var(--warn)" }}>{m.persistence === 1 ? "P" : "NP"}</span>
      <span className="ellipsis" style={{ color: m.preview == null ? "var(--faint)" : "var(--muted)", fontSize: 11 }}>
        {showCtl && m.preview != null && m.text != null ? withControlPictures(m.text.slice(0, 240)) : m.preview ?? `binary · ${bytes(m.size)}`}
      </span>
    </div>
  );
}

function Skeleton() {
  return (
    <>
      {Array.from({ length: 16 }, (_, i) => (
        <div key={i} className="msg-grid" style={{ gridTemplateColumns: GRID, height: 28, borderBottom: "1px solid var(--line-soft)", opacity: Math.max(0.15, 1 - i * 0.06) }}>
          <span className="skel" style={{ justifySelf: "center", width: 13, height: 13, borderRadius: 3 }} />
          <span className="skel" style={{ justifySelf: "end", marginRight: 10, width: 16 }} />
          <span className="skel" style={{ width: 110 + ((i * 37) % 50) }} />
          <span className="skel" style={{ width: i % 4 === 1 ? 90 : 62 }} />
          <span className="skel" style={{ width: 84 }} />
          <span className="skel" style={{ width: 40 }} />
          <span className="skel" style={{ justifySelf: "end", marginRight: 10, width: 30 }} />
          <span className="skel" style={{ width: 8 }} />
          <span className="skel" style={{ width: 14 }} />
          <span className="skel" style={{ width: `${40 + ((i * 23) % 50)}%` }} />
        </div>
      ))}
    </>
  );
}

function FiltersPopover({ tab, b, onClose }: { tab: Tab; b: BrowseState; onClose: () => void }) {
  const patch = (f: Partial<BrowseState["filters"]>) => useApp.getState().patchBrowse(tab.id, { filters: { ...b.filters, ...f } });
  const formats = [...new Set(b.messages.map((m) => m.format || "NONE"))].sort();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => window.addEventListener("mousedown", onDown));
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  return (
    <div ref={ref} className="popover" style={{ top: 40, left: 272, width: 280, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <label className="field"><span className="label">Format</span>
        <select className="input" value={b.filters.format} onChange={(e) => patch({ format: e.target.value })}>
          <option value="">Any</option>
          {formats.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className="field"><span className="label">Content</span>
        <select className="input" value={b.filters.kind} onChange={(e) => patch({ kind: e.target.value })}>
          <option value="">Any</option><option value="json">JSON</option><option value="xml">XML</option><option value="text">Text</option><option value="binary">Binary</option>
        </select>
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, cursor: "pointer" }} onClick={() => patch({ correlOnly: !b.filters.correlOnly })}>
        <Checkbox on={b.filters.correlOnly} large />Only messages with a CorrelId
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn ghost sm" onClick={() => patch({ format: "", kind: "", correlOnly: false })}>Clear</button>
        <button className="btn sm" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
