import { useMemo, useState } from "react";
import { useApp, type PayloadView, type Tab } from "../state";
import { api, asMqError } from "../lib/rpc";
import { b64ToBytes, bytes, copyText, dateOf, idText, isZeroId, n, timeOf } from "../lib/format";
import { hexRows, jsonLines, xmlLines, type Line } from "../lib/highlight";
import { exportMessages, savePayload } from "../lib/transfer";
import { controlSummary, segments } from "../lib/control";
import type { Message } from "../lib/types";
import { resendDraft, visibleMessages } from "./BrowseView";
import { Icon, Segmented, Spinner } from "./ui";

export default function DetailPanel({ tab }: { tab: Tab }) {
  const b = useApp((s) => s.browse[tab.id]);
  const ccsid = useApp((s) => s.settings.defaultCcsid);
  const showCtl = useApp((s) => s.settings.showControlChars);
  const saveSettings = useApp((s) => s.saveSettings);
  const { patchBrowse, setOverlay, replaceMessage, showToast } = useApp.getState();
  const [loadingFull, setLoadingFull] = useState(false);
  const m = b?.messages.find((x) => x.msgId === b.selected);

  const view: PayloadView = useMemo(() => {
    if (!m) return "text";
    const ok = (v: PayloadView) => v === "hex" || (v === "text" && m.text != null) || v === m.kind;
    if (b.pview && ok(b.pview)) return b.pview;
    return m.kind === "binary" ? "hex" : m.kind;
  }, [m, b?.pview]);

  const codeLines: Line[] | null = useMemo(() => {
    if (!m?.text) return null;
    if (view === "json") {
      try {
        return jsonLines(JSON.parse(m.text));
      } catch {
        return null;
      }
    }
    if (view === "xml") return xmlLines(m.text);
    return null;
  }, [m, view]);

  const hex = useMemo(() => (m && view === "hex" ? hexRows(b64ToBytes(m.base64)) : []), [m, view]);

  if (!b || !m) return null;
  const queue = tab.queue!;
  const list = visibleMessages(b);
  const idx = list.findIndex((x) => x.msgId === m.msgId);
  const go = (d: number) => {
    const next = list[idx + d];
    if (next) patchBrowse(tab.id, { selected: next.msgId });
  };
  const corrNone = isZeroId(m.correlId);
  const chips = [
    m.format || "MQFMT_NONE", bytes(m.size), `Priority ${m.priority}`, m.persistence === 1 ? "Persistent" : "Not persistent",
    m.putTime ? `${dateOf(m.putTime)} ${timeOf(m.putTime)}` : null, m.putAppl || null,
    m.backoutCount > 0 ? `Backout ${m.backoutCount}` : null,
  ].filter(Boolean) as string[];

  const loadFull = async () => {
    setLoadingFull(true);
    try {
      replaceMessage(tab.id, await api.detail(tab.connId, queue, m.msgId));
    } catch (e) {
      showToast({ tone: "err", title: "Could not load the full payload", sub: asMqError(e).name });
    } finally {
      setLoadingFull(false);
    }
  };

  const copy = (text: string, what: string) => {
    void copyText(text);
    showToast({ tone: "ok", title: `${what} copied` });
  };

  return (
    <aside style={{ width: 480, flex: "none", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)", borderLeft: "1px solid var(--line)" }}>
      <div style={{ height: 40, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 16px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontWeight: 600 }}>Message</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>#{m.seq}</span>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>of {n(Math.max(b.depth, b.messages.length))}</span>
        <div className="spacer" />
        <button className="icon-btn sm" title="Previous (↑)" disabled={idx <= 0} onClick={() => go(-1)}><Icon name="ph-caret-up" /></button>
        <button className="icon-btn sm" title="Next (↓)" disabled={idx >= list.length - 1} onClick={() => go(1)}><Icon name="ph-caret-down" /></button>
        <button className="icon-btn sm" title="Close" onClick={() => patchBrowse(tab.id, { detailClosed: true })}><Icon name="ph-x" /></button>
      </div>

      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--line)" }}>
        <IdLine label="MSG ID" value={m.msgId} onCopy={() => copy(m.msgId, "MsgId")} />
        <IdLine label="CORREL ID" value={corrNone ? `${m.correlId}  (MQCI_NONE)` : m.correlId} note={idText(m.correlId)} faint={corrNone} onCopy={() => copy(m.correlId, "CorrelId")} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 2 }}>
          {chips.map((c) => <span key={c} className="chip">{c}</span>)}
        </div>
      </div>

      <div style={{ height: 36, flex: "none", display: "flex", gap: 2, padding: "0 8px", borderBottom: "1px solid var(--line)" }}>
        {([["payload", "Payload", ""], ["mqmd", "MQMD", String(m.mqmd.length)], ["props", "Properties", String(m.props.length)]] as const).map(([k, label, count]) => (
          <div key={k} onClick={() => patchBrowse(tab.id, { detailTab: k })} style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, padding: "0 10px", cursor: "pointer", color: b.detailTab === k ? "var(--text)" : "var(--muted)", fontSize: 12.5, fontWeight: 500 }}>
            <span>{label}</span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>{count}</span>
            <div style={{ position: "absolute", left: 8, right: 8, bottom: -1, height: 2, background: b.detailTab === k ? "var(--accent)" : "transparent" }} />
          </div>
        ))}
      </div>

      {b.detailTab === "payload" && (
        <>
          <div style={{ height: 40, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}>
            <div style={{ background: "var(--bg)", borderRadius: 6 }}>
              <Segmented<PayloadView>
                mono
                value={view}
                onChange={(v) => patchBrowse(tab.id, { pview: v })}
                options={[
                  { value: "text", label: "Text", disabled: m.text == null },
                  { value: "json", label: "JSON", disabled: m.kind !== "json" },
                  { value: "xml", label: "XML", disabled: m.kind !== "xml" },
                  { value: "hex", label: "Hex" },
                ]}
              />
            </div>
            <button
              className="icon-btn sm"
              title={showCtl ? "Hide control characters" : "Show control characters (CR, LF, SOH, STX, ETX…)"}
              onClick={() => void saveSettings({ showControlChars: !showCtl })}
              disabled={m.text == null}
              style={showCtl ? { color: "var(--accent)", background: "var(--accent-bg)" } : undefined}
            >
              <Icon name="ph-paragraph" />
            </button>
            <div className="spacer" />
            <span className="mono" style={{ fontSize: 11, color: "var(--faint)", flex: "none" }}>{m.charset} · {m.ccsid}</span>
            <button className="icon-btn sm" title="Copy payload" onClick={() => copy(m.text ?? m.base64, "Payload")}><Icon name="ph-copy" /></button>
            <button className="icon-btn sm" title="Save to file" onClick={() => void savePayload(m)}><Icon name="ph-floppy-disk" /></button>
          </div>
          {showCtl && m.text != null && view === "text" && (
            <div className="mono ellipsis" style={{ margin: "0 12px 8px", fontSize: 11, color: "var(--muted)" }} title={controlSummary(m.text)}>
              <span style={{ color: "var(--faint)" }}>Control characters: </span>{controlSummary(m.text)}
            </div>
          )}
          {m.truncated && (
            <div style={{ margin: "0 12px 8px", fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="ph-scissors" color="var(--warn)" />Showing the first {bytes(b64ToBytes(m.base64).length)} of {bytes(m.size)}.
              <button className="btn link xs" onClick={() => void loadFull()} disabled={loadingFull}>{loadingFull ? <Spinner size={12} /> : null}Load full payload</button>
            </div>
          )}
          <div className="mono" style={{ flex: 1, minHeight: 0, overflow: "auto", margin: "0 12px 12px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "10px 0", fontSize: 12, lineHeight: 1.65 }}>
            <PayloadBody m={m} view={view} code={codeLines} hex={hex} showCtl={showCtl} />
          </div>
        </>
      )}

      {b.detailTab === "mqmd" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {m.mqmd.map((f) => (
            <div key={f.k} className="mono hoverable" style={{ display: "grid", gridTemplateColumns: "132px minmax(0,1fr)", gap: 10, padding: "5px 16px", borderBottom: "1px solid var(--line-soft)", fontSize: 11.5, lineHeight: 1.5 }}>
              <span style={{ color: "var(--muted)" }}>{f.k}</span>
              <span style={{ wordBreak: "break-all" }}>
                <span style={{ color: f.v === "" || /^0+$/.test(f.v) ? "var(--faint)" : "var(--text)" }}>{f.v === "" ? "—" : f.v}</span>
                {f.dec && <span style={{ color: "var(--faint)", marginLeft: 8 }}>{f.dec}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {b.detailTab === "props" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div className="col-head" style={{ display: "grid", gridTemplateColumns: "150px 58px minmax(0,1fr)", gap: 10, padding: "8px 16px", borderBottom: "1px solid var(--line)" }}>
            <span>NAME</span><span>TYPE</span><span>VALUE</span>
          </div>
          {m.props.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>This message has no properties.</div>}
          {m.props.map((p) => (
            <div key={p.k} className="mono hoverable" style={{ display: "grid", gridTemplateColumns: "150px 58px minmax(0,1fr)", gap: 10, padding: "6px 16px", borderBottom: "1px solid var(--line-soft)", fontSize: 11.5, lineHeight: 1.5 }}>
              <span className="ellipsis" style={{ color: "var(--syn-key)" }} title={p.k}>{p.k}</span>
              <span style={{ color: "var(--faint)" }}>{p.t}</span>
              <span style={{ wordBreak: "break-all" }}>{p.v}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ height: 50, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderTop: "1px solid var(--line)" }}>
        <button className="btn" onClick={() => setOverlay({ kind: "put", connId: tab.connId, queue, draft: resendDraft(m, ccsid) })}><Icon name="ph-repeat" />Copy &amp; resend</button>
        <button className="btn" onClick={() => void exportMessages(queue, [m])}><Icon name="ph-export" />Export</button>
        <div className="spacer" />
        <button className="btn danger" onClick={() => setOverlay({ kind: "delete", connId: tab.connId, queue, msgIds: [m.msgId] })}><Icon name="ph-trash" />Delete</button>
      </div>
    </aside>
  );
}

function IdLine({ label, value, note, faint, onCopy }: { label: string; value: string; note?: string | null; faint?: boolean; onCopy: () => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "66px minmax(0,1fr) 22px", gap: 8, alignItems: "start" }}>
      <span className="col-head" style={{ paddingTop: 2 }}>{label}</span>
      <span className="mono" style={{ fontSize: 11.5, lineHeight: 1.5, wordBreak: "break-all", color: faint ? "var(--faint)" : "var(--text)" }}>
        {value}
        {note && <span style={{ color: "var(--syn-str)", marginLeft: 8 }}>&quot;{note}&quot;</span>}
      </span>
      <i className="ph-light ph-copy" title="Copy" onClick={onCopy} style={{ fontSize: 14, color: "var(--muted)", cursor: "pointer", paddingTop: 2 }} />
    </div>
  );
}

function PayloadBody({ m, view, code, hex, showCtl }: { m: Message; view: PayloadView; code: Line[] | null; hex: ReturnType<typeof hexRows>; showCtl: boolean }) {
  if (view === "hex") {
    const total = Math.ceil(b64ToBytes(m.base64).length / 16);
    return (
      <>
        {hex.map((r) => (
          <div key={r.off} style={{ display: "flex", gap: 10, padding: "0 8px", fontSize: 10, whiteSpace: "pre" }}>
            <span style={{ color: "var(--faint)" }}>{r.off}</span><span>{r.hex}</span><span style={{ color: "var(--muted)" }}>{r.asc}</span>
          </div>
        ))}
        {total > hex.length && <div style={{ padding: "6px 12px", color: "var(--faint)", fontSize: 11.5 }}>… {n(total - hex.length)} more rows — save to file for the rest</div>}
      </>
    );
  }
  if ((view === "json" || view === "xml") && code) {
    return (
      <>
        {code.map((ln) => (
          <div key={ln.n} style={{ display: "flex" }}>
            <span style={{ width: 34, flex: "none", textAlign: "right", paddingRight: 14, color: "var(--faint)", userSelect: "none" }}>{ln.n}</span>
            <span style={{ whiteSpace: "pre" }}>{ln.toks.map((t, i) => <span key={i} style={{ color: t.c }}>{t.t}</span>)}</span>
          </div>
        ))}
      </>
    );
  }
  if (showCtl && m.text) return <ControlText text={m.text} />;
  return <div style={{ padding: "0 14px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{m.text ?? ""}</div>;
}

/** Text with every control character drawn as a small labelled marker; line breaks follow LF (or a lone CR). */
function ControlText({ text }: { text: string }) {
  const segs = useMemo(() => segments(text), [text]);
  return (
    <div style={{ padding: "0 14px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
      {segs.map((s, i) => {
        if (s.kind === "text") return <span key={i}>{s.text}</span>;
        // Line endings and tabs are common and quiet; framing characters (SOH, STX…) stand out.
        const quiet = s.lineEnd || s.code === 9;
        return (
          <span key={i}>
            <span
              title={`${s.name} (0x${s.code.toString(16).padStart(2, "0").toUpperCase()})`}
              style={{
                display: "inline-block", font: "600 9px/14px 'JetBrains Mono', monospace", padding: "0 3px", margin: "0 1px", borderRadius: 3,
                verticalAlign: 1, letterSpacing: ".02em",
                color: quiet ? "var(--faint)" : "var(--warn)",
                background: quiet ? "var(--raised)" : "var(--warn-bg)",
                border: `1px solid ${quiet ? "var(--line2)" : "var(--warn)"}`,
              }}
            >
              {s.name}
            </span>
            {s.breakAfter ? "\n" : ""}
          </span>
        );
      })}
    </div>
  );
}
