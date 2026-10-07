import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { connOf, emptyMqmd, useApp, type Overlay, type PutDraft } from "../../state";
import { controlName, controlPicture, controlSummary, fromEditorText, INSERTABLE, isControlPicture, toEditorText } from "../../lib/control";
import { putAndReport } from "../../lib/drafts";
import { b64ToBytes, bytes, n } from "../../lib/format";
import { prettyXml, tokenizeJsonText, tokenizeXmlText, type Tok } from "../../lib/highlight";
import { errorText, FUNCTIONS, hasTemplate, parseTemplate, renderTemplate, templateForFormat, type Parsed } from "../../lib/template";
import { pickPayloadFile } from "../../lib/transfer";
import type { PutMqmd, PutProperty } from "../../lib/types";
import { EnvBadge, Field, Icon, press, Segmented, Spinner, StatusDot } from "../ui";

const PROP_TYPES = ["String", "Int32", "Int64", "Int16", "Int8", "Boolean", "Float32", "Float64", "Bytes"];
const FORMATS = ["MQSTR", "MQHRF2", "NONE"];

type Validity = { label: string; ok: boolean | null };

function validity(body: string): Validity {
  const t = body.trim();
  if (!t) return { label: "Empty", ok: null };
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return { label: "JSON · valid", ok: true };
    } catch (e) {
      return { label: `JSON · ${(e as Error).message.replace(/^JSON\.parse: /, "").slice(0, 60)}`, ok: false };
    }
  }
  if (t.startsWith("<")) {
    const bad = new DOMParser().parseFromString(t, "application/xml").getElementsByTagName("parsererror").length > 0;
    return bad ? { label: "XML · not well-formed", ok: false } : { label: "XML · valid", ok: true };
  }
  return { label: "Text", ok: null };
}

export default function PutDialog({ overlay }: { overlay: Extract<Overlay, { kind: "put" }> }) {
  const conn = useApp((s) => connOf(s, overlay.connId));
  const st = useApp((s) => s.status[overlay.connId]);
  const templates = useApp((s) => s.templates);
  const ccsid = useApp((s) => s.settings.defaultCcsid);
  const { setOverlay, showToast, saveTemplates } = useApp.getState();

  const opened = templates.find((t) => t.name === overlay.draftName);
  const [queue, setQueue] = useState(opened?.queue || overlay.queue);
  const [d, setD] = useState<PutDraft>(() => {
    const base: Partial<PutDraft> = opened
      ? { body: opened.body, mqmd: opened.mqmd, properties: opened.properties, count: opened.count ?? 1 }
      : overlay.draft ?? {};
    return { body: "", properties: [], count: 1, ...base, mqmd: { ...emptyMqmd(ccsid), ...base.mqmd } };
  });
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const [sending, setSending] = useState(false);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [activeTemplate, setActiveTemplate] = useState(opened?.name ?? "");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const setMd = (p: Partial<PutMqmd>) => setD((x) => ({ ...x, mqmd: { ...x.mqmd, ...p } }));
  const setProp = (i: number, p: Partial<PutProperty>) => setD((x) => ({ ...x, properties: x.properties.map((q, j) => (j === i ? { ...q, ...p } : q)) }));

  const binary = d.bodyBase64 != null;
  // {{ fn() }} expressions: validity is judged on a rendered sample, so `"n": {{index()}}` still counts as JSON.
  const tpl = useMemo(() => (!binary && hasTemplate(d.body) ? parseTemplate(d.body) : null), [binary, d.body]);
  const tplError = tpl?.errors[0];
  const v = useMemo<Validity>(() => {
    if (binary) return { label: "Binary", ok: null };
    if (tplError) return { label: `Template · ${errorText(d.body, tplError)}`, ok: false };
    if (!tpl?.calls.length) return validity(d.body);
    const sv = validity(renderTemplate(tpl, 0, d.count));
    return { label: `Template · ${tpl.calls.length} expr · ${sv.label}`, ok: sv.ok };
  }, [binary, tpl, tplError, d.body, d.count]);
  const size = binary ? b64ToBytes(d.bodyBase64!).length : new TextEncoder().encode(d.body).length;
  // The textarea and its highlight layer show the editor form, where SOH/STX/ETX/CR… are visible glyphs.
  const shown = useMemo(() => toEditorText(d.body), [d.body]);
  const ctlInfo = useMemo(() => (/[\x00-\x08\x0b-\x1f\x7f]/.test(d.body) ? controlSummary(d.body) : null), [d.body]);
  const lines = useMemo<Tok[][]>(() => {
    const t = shown.trimStart();
    const toks = t.startsWith("{") || t.startsWith("[") ? tokenizeJsonText(shown)
      : t.startsWith("<") ? tokenizeXmlText(shown)
      : shown.split("\n").map((l) => [{ t: l, c: "var(--text)" }]);
    const ranges = tpl ? templateRanges(shown, tpl) : [];
    return toks.map((line, ln) => splitControlTokens(ranges[ln] ? recolor(line, ranges[ln]) : line));
  }, [shown, tpl]);
  const [menu, setMenu] = useState<"insert" | "preview" | null>(null);
  const queues = (st?.queues ?? []).filter((q) => (q.access ? q.access.put : !q.name.startsWith("SYSTEM.") && q.type !== "Model"));

  if (!conn) return null;

  const trackCursor = () => {
    const ta = taRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const ln = before.split("\n").length;
    setCursor({ ln, col: ta.selectionStart - before.lastIndexOf("\n") });
  };

  const setShown = (text: string) => setD((x) => ({ ...x, body: fromEditorText(text) }));
  const replaceSelection = (ins: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    setShown(ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + ins.length, s + ins.length);
      trackCursor();
    });
  };

  // Formatting goes through templateForFormat so {{ … }} expressions survive the round trip.
  const formatJson = () => {
    const f = templateForFormat(d.body);
    try {
      const body = f.restore(JSON.stringify(JSON.parse(f.text), null, 2));
      setD((x) => ({ ...x, body }));
      setCursor({ ln: 1, col: 1 });
    } catch (e) {
      showToast({ tone: "err", title: "Not valid JSON", sub: (e as Error).message });
    }
  };
  const formatXml = () => {
    const f = templateForFormat(d.body.trim());
    const p = prettyXml(f.text);
    if (p) {
      setD((x) => ({ ...x, body: f.restore(p) }));
      setCursor({ ln: 1, col: 1 });
    }
    else showToast({ tone: "err", title: "Not well-formed XML" });
  };
  const loadFile = async () => {
    const f = await pickPayloadFile();
    if (!f) return;
    if (f.text != null) setD((x) => ({ ...x, body: f.text!, bodyBase64: undefined, fileName: undefined }));
    else setD((x) => ({ ...x, body: "", bodyBase64: f.base64, fileName: f.name, mqmd: { ...x.mqmd, format: "NONE" } }));
  };

  const applyTemplate = (name: string) => {
    setActiveTemplate(name);
    const t = templates.find((x) => x.name === name);
    if (!t) return;
    setD((x) => ({ ...x, body: t.body, bodyBase64: undefined, fileName: undefined, mqmd: { ...emptyMqmd(ccsid), ...t.mqmd }, properties: t.properties, count: t.count ?? 1 }));
    if (t.queue) setQueue(t.queue);
  };
  const saveTemplate = async () => {
    const name = templateName?.trim();
    if (!name) return;
    const draft = { name, body: d.body, mqmd: d.mqmd, properties: d.properties, queue: queue.trim() || undefined, connId: conn.id, count: d.count };
    await saveTemplates([...templates.filter((t) => t.name !== name), draft]);
    setActiveTemplate(name);
    setTemplateName(null);
    showToast({ tone: "ok", title: `Draft "${name}" saved`, sub: draft.queue ? `Send it to ${draft.queue} from the Drafts list in one click` : undefined });
  };

  const send = async () => {
    if (!queue.trim()) return;
    setSending(true);
    const body = binary ? { bodyBase64: d.bodyBase64 } : { body: d.body };
    const ok = await putAndReport(conn.id, queue.trim(), body, d.mqmd, d.properties, d.count);
    setSending(false);
    if (ok) setOverlay(null);
  };

  return (
    <div className="modal" style={{ top: 50, width: 1020, height: "min(800px, calc(100% - 80px))" }}>
      <div style={{ height: 58, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 12px 0 20px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Put message</span>
        <div className="input mono" style={{ width: 260, height: 32, marginLeft: 8, fontSize: 12.5 }}>
          <Icon name="ph-tray" color="var(--muted)" />
          <input list="mq-put-queues" value={queue} onChange={(e) => setQueue(e.target.value)} placeholder="QUEUE.NAME" spellCheck={false} />
          <datalist id="mq-put-queues">{queues.map((q) => <option key={q.name} value={q.name}>{q.type}</option>)}</datalist>
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>on</span>
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
          <StatusDot state={st?.state} size={7} />{conn.name}<EnvBadge env={conn.env} />
        </span>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => setOverlay(null)}><Icon name="ph-x" /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px" }}>
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 16px 16px 20px", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="mono" style={{ height: 24, display: "flex", alignItems: "center", gap: 6, padding: "0 8px", borderRadius: 4, fontSize: 11.5, fontWeight: 500, background: v.ok === false ? "var(--err-bg)" : v.ok ? "var(--ok-bg)" : "var(--raised)", color: v.ok === false ? "var(--err)" : v.ok ? "var(--ok)" : "var(--muted)" }}>
              <Icon name={v.ok === false ? "ph-warning" : v.ok ? "ph-check" : "ph-text-aa"} />{v.label}
            </span>
            {tpl && tpl.calls.length > 0 && !tplError && (
              <div style={{ position: "relative" }}>
                <button className="btn ghost sm" style={{ fontWeight: 400 }} onClick={() => setMenu((m) => (m === "preview" ? null : "preview"))} title="See what the rendered messages look like">
                  <Icon name="ph-eye" color="var(--muted)" />Preview
                </button>
                {menu === "preview" && <PreviewPopover tpl={tpl} count={d.count} onClose={() => setMenu(null)} />}
              </div>
            )}
            <div className="spacer" />
            <div style={{ position: "relative" }}>
              <button className="btn outline sm" style={{ fontWeight: 400 }} onClick={() => setMenu((m) => (m === "insert" ? null : "insert"))} disabled={binary} title="Insert a {{ function }} or a control character (SOH, STX, ETX…) at the cursor">
                <Icon name="ph-plus-square" color="var(--muted)" />Insert
              </button>
              {menu === "insert" && (
                <InsertMenu
                  onClose={() => setMenu(null)}
                  onFunction={(example) => { setMenu(null); replaceSelection(`{{${example}}}`); }}
                  onControl={(code) => { setMenu(null); replaceSelection(controlPicture(code)); }}
                />
              )}
            </div>
            <button className="btn outline sm" style={{ fontWeight: 400 }} onClick={formatJson} disabled={binary}><Icon name="ph-brackets-curly" color="var(--muted)" />Format JSON</button>
            <button className="btn outline sm" style={{ fontWeight: 400 }} onClick={formatXml} disabled={binary}><Icon name="ph-code" color="var(--muted)" />Format XML</button>
            <button className="btn outline sm" style={{ fontWeight: 400 }} onClick={() => void loadFile()}><Icon name="ph-file-arrow-up" color="var(--muted)" />Load file…</button>
          </div>

          {binary ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--bg)", border: "1px solid var(--line2)", borderRadius: 6 }}>
              <Icon name="ph-file-binary" size={32} color="var(--muted)" />
              <div style={{ fontWeight: 600 }}>{d.fileName ?? "Binary payload"}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{bytes(size)} sent as-is · format {d.mqmd.format}</div>
              <button className="btn sm" onClick={() => setD((x) => ({ ...x, bodyBase64: undefined, fileName: undefined, body: "" }))}>Replace with text</button>
            </div>
          ) : (
            <div className="mono" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)", border: "1px solid var(--accent)", boxShadow: "0 0 0 3px var(--accent-bg)", borderRadius: 6, padding: "10px 0", fontSize: 12.5, lineHeight: 1.7 }} role="presentation" onClick={() => taRef.current?.focus()}>
              <div style={{ display: "flex", minHeight: "100%" }}>
                <div style={{ width: 36, flex: "none", textAlign: "right", paddingRight: 14, color: "var(--faint)", userSelect: "none" }}>
                  {lines.map((_, i) => <div key={i} style={{ background: i + 1 === cursor.ln ? "var(--hover)" : undefined }}>{i + 1}</div>)}
                </div>
                <div style={{ position: "relative", flex: 1, display: "grid", minWidth: 0 }}>
                  <pre aria-hidden style={{ gridArea: "1/1", margin: 0, font: "inherit", whiteSpace: "pre", pointerEvents: "none", paddingRight: 16 }}>
                    {lines.map((toks, i) => (
                      <div key={i} style={{ background: i + 1 === cursor.ln ? "var(--hover)" : undefined }}>
                        {toks.length ? toks.map((t, j) => <span key={j} style={MARK_STYLE[t.c] ?? { color: t.c }} title={t.c === CTL ? ctlTitle(t.t) : undefined}>{t.t}</span>) : " "}
                      </div>
                    ))}
                  </pre>
                  <textarea
                    ref={taRef}
                    value={shown}
                    spellCheck={false}
                    wrap="off"
                    placeholder="Message body — JSON, XML or text · {{ uuid() }}, {{ index() }}… vary each copy (Insert ▸ Functions)"
                    onChange={(e) => { setShown(e.target.value); trackCursor(); }}
                    onKeyUp={trackCursor}
                    onClick={trackCursor}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        replaceSelection("  ");
                      }
                    }}
                    style={{ gridArea: "1/1", width: "100%", height: "100%", margin: 0, padding: 0, border: "none", outline: "none", resize: "none", background: "transparent", color: "transparent", caretColor: "var(--text)", font: "inherit", lineHeight: "inherit", whiteSpace: "pre", overflow: "hidden" }}
                  />
                </div>
              </div>
            </div>
          )}
          <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--faint)" }}>
            <span>{binary ? "Binary" : `Ln ${cursor.ln}, Col ${cursor.col} · Spaces: 2`}{!binary && ctlInfo && <span style={{ color: "var(--warn)" }} title="Control characters in the body"> · {ctlInfo}</span>}</span>
            <span>CCSID {d.mqmd.ccsid} · {n(size)} B</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="caps" style={{ flex: 1 }}>MESSAGE PROPERTIES</span>
              <button className="btn link xs" onClick={() => setD((x) => ({ ...x, properties: [...x.properties, { name: "", type: "String", value: "" }] }))}><Icon name="ph-plus" />Add property</button>
            </div>
            {d.properties.length > 0 && (
              <div style={{ border: "1px solid var(--line)", borderRadius: 6, overflow: "hidden", maxHeight: 160, overflowY: "auto" }}>
                {d.properties.map((p, i) => (
                  <div key={i} className="mono" style={{ display: "grid", gridTemplateColumns: "200px 100px minmax(0,1fr) 30px", alignItems: "center", borderBottom: "1px solid var(--line-soft)", fontSize: 12, height: 32 }}>
                    <input value={p.name} onChange={(e) => setProp(i, { name: e.target.value })} placeholder="name" spellCheck={false} style={{ height: "100%", padding: "0 10px", border: "none", background: "transparent", outline: "none", color: "var(--syn-key)", font: "inherit" }} />
                    <select value={p.type} onChange={(e) => setProp(i, { type: e.target.value })} style={{ height: "100%", border: "none", background: "transparent", color: "var(--muted)", fontSize: 11.5, outline: "none", cursor: "pointer" }}>
                      {PROP_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <input value={p.value} onChange={(e) => setProp(i, { value: e.target.value })} placeholder={p.type === "Bytes" ? "hex" : "value"} spellCheck={false} style={{ height: "100%", padding: "0 10px", border: "none", borderLeft: "1px solid var(--line-soft)", background: "transparent", outline: "none", font: "inherit" }} />
                    <i className="ph-light ph-x" style={{ color: "var(--faint)", fontSize: 12, cursor: "pointer", justifySelf: "center" }} {...press(() => setD((x) => ({ ...x, properties: x.properties.filter((_, j) => j !== i) })))} aria-label="Remove property" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ minHeight: 0, overflow: "auto", borderLeft: "1px solid var(--line)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, background: "var(--bg)" }}>
          <div className="caps">MQMD · OPTIONAL</div>
          <Field label="Message ID"><input className="input mono on-panel" value={d.mqmd.msgId} onChange={(e) => setMd({ msgId: e.target.value })} placeholder="Generated by QM (MQMI_NONE)" spellCheck={false} /></Field>
          <Field label="Correlation ID"><input className="input mono on-panel" value={d.mqmd.correlId} onChange={(e) => setMd({ correlId: e.target.value })} placeholder="MQCI_NONE · text or 48 hex" spellCheck={false} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px", gap: 10 }}>
            <Field label="Format">
              <div className="input mono on-panel">
                <input list="mq-formats" value={d.mqmd.format} onChange={(e) => setMd({ format: e.target.value.toUpperCase().slice(0, 8) })} spellCheck={false} />
                <datalist id="mq-formats">{FORMATS.map((f) => <option key={f} value={f} />)}</datalist>
              </div>
            </Field>
            <Field label="Priority">
              <input className="input mono on-panel" type="number" min={0} max={9} value={d.mqmd.priority ?? ""} placeholder="def" onChange={(e) => setMd({ priority: e.target.value === "" ? null : Math.max(0, Math.min(9, Number(e.target.value))) })} />
            </Field>
          </div>
          <Field label="Persistence">
            <Segmented<"P" | "NP" | "Q"> fill value={d.mqmd.persistence} onChange={(p) => setMd({ persistence: p })} options={[{ value: "P", label: "Persistent" }, { value: "NP", label: "Not persistent" }, { value: "Q", label: "Queue default" }]} />
          </Field>
          <Field label="Expiry">
            <div className="input mono on-panel">
              <input type="number" min={1} value={d.mqmd.expiry ?? ""} placeholder="Unlimited" onChange={(e) => setMd({ expiry: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })} />
              <span style={{ fontFamily: "'IBM Plex Sans'", fontSize: 11, color: "var(--faint)" }}>1/10 s</span>
            </div>
          </Field>
          <Field label="Reply-to queue"><input className="input mono on-panel" value={d.mqmd.replyToQ} onChange={(e) => setMd({ replyToQ: e.target.value })} placeholder="(none)" spellCheck={false} /></Field>
          <Field label="Reply-to queue manager"><input className="input mono on-panel" value={d.mqmd.replyToQmgr} onChange={(e) => setMd({ replyToQmgr: e.target.value })} placeholder="Same as target" spellCheck={false} /></Field>
          <Field label="CCSID">
            <select className="input mono on-panel" value={d.mqmd.ccsid} onChange={(e) => setMd({ ccsid: Number(e.target.value) })}>
              {[[1208, "UTF-8"], [819, "ISO-8859-1"], [1252, "Windows-1252"], [37, "EBCDIC US"], [500, "EBCDIC Intl"]].map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
            </select>
          </Field>
          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
          <Field label="Send count">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", height: 30, border: "1px solid var(--line2)", borderRadius: 5, background: "var(--panel)" }}>
                <span {...press(() => setD((x) => ({ ...x, count: Math.max(1, x.count - 1) })))} aria-label="Fewer copies" style={{ width: 30, height: "100%", display: "grid", placeItems: "center", cursor: "pointer", color: "var(--muted)" }}><Icon name="ph-minus" /></span>
                <input className="mono" value={d.count} onChange={(e) => setD((x) => ({ ...x, count: Math.max(1, Math.min(10000, Number(e.target.value.replace(/\D/g, "")) || 1)) }))} style={{ width: 52, textAlign: "center", fontSize: 12.5, border: "none", borderLeft: "1px solid var(--line)", borderRight: "1px solid var(--line)", height: "100%", background: "transparent", outline: "none" }} />
                <span {...press(() => setD((x) => ({ ...x, count: Math.min(10000, x.count + 1) })))} aria-label="More copies" style={{ width: 30, height: "100%", display: "grid", placeItems: "center", cursor: "pointer", color: "var(--muted)" }}><Icon name="ph-plus" /></span>
              </div>
              <span style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.35 }}>Each copy gets its own MsgId</span>
            </div>
          </Field>
        </div>
      </div>

      <div style={{ height: 62, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 20px", borderTop: "1px solid var(--line)" }}>
        <div className="input" style={{ width: 320, height: 32 }}>
          <Icon name="ph-note-pencil" color="var(--muted)" />
          <select value={activeTemplate} onChange={(e) => applyTemplate(e.target.value)} disabled={!templates.length}>
            <option value="">{templates.length ? "Draft…" : "No drafts yet"}</option>
            {templates.map((t) => <option key={t.name} value={t.name}>{t.name}{t.queue ? ` → ${t.queue}` : ""}</option>)}
          </select>
        </div>
        {templateName === null ? (
          <button className="btn ghost" onClick={() => setTemplateName(activeTemplate)} disabled={binary}><Icon name="ph-floppy-disk" />{activeTemplate ? "Save draft" : "Save as draft"}</button>
        ) : (
          <div className="input" style={{ width: 240, height: 32, paddingRight: 4 }}>
            <input autoFocus value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="draft name" onKeyDown={(e) => { if (e.key === "Enter") void saveTemplate(); if (e.key === "Escape") { e.stopPropagation(); setTemplateName(null); } }} />
            <span className="input-btn" {...press(() => void saveTemplate())}>Save</span>
          </div>
        )}
        <div className="spacer" />
        {conn.env === "PROD" && <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--err)" }}><Icon name="ph-warning" />Target is a PROD queue</span>}
        <button className="btn outline lg" style={{ marginLeft: 8 }} onClick={() => setOverlay(null)}>Cancel</button>
        <button className="btn primary lg" style={{ padding: "0 16px" }} onClick={() => void send()} disabled={sending || !queue.trim() || st?.state !== "connected" || !!tplError} title={tplError ? "Fix the template error first" : undefined}>
          {sending ? <Spinner /> : <Icon name="ph-paper-plane-tilt" />}{d.count > 1 ? `Send ${d.count} messages` : "Send message"}
        </button>
      </div>
    </div>
  );
}

const CTL = "ctl";
const TPL = "tpl";
const TPL_ERR = "tpl-err";
const CTL_STYLE = { color: "var(--warn)", background: "var(--warn-bg)", borderRadius: 2 } as const;
// Colour only — no padding or borders — so the highlight layer stays glyph-aligned with the textarea.
const MARK_STYLE: Record<string, CSSProperties> = {
  [CTL]: CTL_STYLE,
  [TPL]: { color: "var(--accent)", background: "var(--accent-bg)", borderRadius: 2 },
  [TPL_ERR]: { color: "var(--err)", background: "var(--err-bg)", borderRadius: 2, textDecoration: "underline wavy" },
};
const ctlTitle = (glyphs: string) => [...glyphs].map((g) => {
  const code = g.charCodeAt(0) === 0x2421 ? 127 : g.charCodeAt(0) - 0x2400;
  return `${controlName(code)} (0x${code.toString(16).padStart(2, "0").toUpperCase()})`;
}).join(" ");

type Range = { from: number; to: number; c: string };

/** Per-line column ranges of template calls and errors (an expression never spans lines). */
function templateRanges(text: string, tpl: Parsed): Record<number, Range[]> {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const out: Record<number, Range[]> = {};
  const add = (start: number, end: number, c: string) => {
    let ln = 0;
    while (ln + 1 < starts.length && starts[ln + 1] <= start) ln++;
    const lineEnd = ln + 1 < starts.length ? starts[ln + 1] - 1 : text.length;
    (out[ln] ??= []).push({ from: start - starts[ln], to: Math.min(end, lineEnd) - starts[ln], c });
  };
  for (const c of tpl.calls) add(c.start, c.end, TPL);
  for (const e of tpl.errors) add(e.start, e.end, TPL_ERR);
  return out;
}

/** Re-colours the given column ranges of a highlighted line, splitting tokens where needed. */
function recolor(toks: Tok[], ranges: Range[]): Tok[] {
  const out: Tok[] = [];
  let col = 0;
  for (const tok of toks) {
    let k = 0;
    while (k < tok.t.length) {
      const at = col + k;
      const r = ranges.find((x) => at >= x.from && at < x.to);
      const next = r ? r.to : Math.min(...ranges.filter((x) => x.from > at).map((x) => x.from), Infinity);
      const len = Math.min(tok.t.length - k, next - at);
      out.push({ t: tok.t.slice(k, k + len), c: r ? r.c : tok.c });
      k += len;
    }
    col += tok.t.length;
  }
  return out;
}

/** Splits highlighted tokens so control pictures get their own marker colour without shifting any glyph. */
function splitControlTokens(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const tok of toks) {
    let run = "", ctl = "";
    for (const ch of tok.t) {
      if (isControlPicture(ch)) {
        if (run) out.push({ t: run, c: tok.c });
        run = "";
        ctl += ch;
      } else {
        if (ctl) out.push({ t: ctl, c: CTL });
        ctl = "";
        run += ch;
      }
    }
    if (run) out.push({ t: run, c: tok.c });
    if (ctl) out.push({ t: ctl, c: CTL });
  }
  return out;
}

/** A popover under its (relatively positioned) trigger that closes on an outside click. */
function Popover({ onClose, style, children }: { onClose: () => void; style?: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    setTimeout(() => window.addEventListener("mousedown", onDown));
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  return <div ref={ref} className="popover" style={{ top: 30, display: "flex", flexDirection: "column", gap: 6, ...style }}>{children}</div>;
}

function InsertMenu({ onFunction, onControl, onClose }: { onFunction: (example: string) => void; onControl: (code: number) => void; onClose: () => void }) {
  return (
    <Popover onClose={onClose} style={{ right: 0, width: 380, maxHeight: 520, overflowY: "auto" }}>
      <div className="caps" style={{ padding: "2px 4px" }}>FUNCTIONS · EVALUATED PER MESSAGE</div>
      {Object.values(FUNCTIONS).map((f) => (
        <div key={f.signature} className="menu-item" style={{ height: "auto", padding: "5px 8px", flexDirection: "column", alignItems: "flex-start", gap: 1 }} onMouseDown={(e) => e.preventDefault()} {...press(() => onFunction(f.example), "menuitem")}>
          <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>{f.signature}</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{f.description}</span>
        </div>
      ))}
      <div style={{ height: 1, background: "var(--line)", margin: "2px 0" }} />
      <div className="caps" style={{ padding: "2px 4px" }}>CONTROL CHARACTERS · SENT AS THE REAL BYTE</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
        {INSERTABLE.map(({ code, name }) => (
          <div
            key={code}
            className="menu-item mono"
            style={{ padding: "0 6px", fontSize: 11.5, gap: 6 }}
            title={`${name} (0x${code.toString(16).padStart(2, "0").toUpperCase()})`}
            onMouseDown={(e) => e.preventDefault()}
            {...press(() => onControl(code), "menuitem")}
          >
            <span style={CTL_STYLE}>{controlPicture(code)}</span>{name}
          </div>
        ))}
      </div>
    </Popover>
  );
}

/** Rendered message i of the batch, with fresh random values on every step or regenerate. */
function PreviewPopover({ tpl, count, onClose }: { tpl: Parsed; count: number; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [nonce, setNonce] = useState(0);
  const idx = Math.min(i, count - 1);
  const text = useMemo(() => toEditorText(renderTemplate(tpl, idx, count)), [tpl, idx, count, nonce]);
  return (
    <Popover onClose={onClose} style={{ left: 0, width: 520 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px" }}>
        <span className="caps" style={{ flex: 1 }}>PREVIEW · MESSAGE {idx + 1} OF {count}</span>
        <button className="icon-btn sm" title="Previous message" disabled={idx === 0} onClick={() => setI(idx - 1)}><Icon name="ph-caret-left" /></button>
        <button className="icon-btn sm" title="Next message" disabled={idx >= count - 1} onClick={() => setI(idx + 1)}><Icon name="ph-caret-right" /></button>
        <button className="icon-btn sm" title="Regenerate random values" onClick={() => setNonce((x) => x + 1)}><Icon name="ph-arrows-clockwise" /></button>
      </div>
      <pre className="mono" style={{ margin: 0, maxHeight: 360, overflow: "auto", padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{text}</pre>
      <div style={{ fontSize: 11.5, color: "var(--faint)", padding: "0 2px" }}>Random values are drawn again when the messages are sent.</div>
    </Popover>
  );
}
