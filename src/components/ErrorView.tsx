import { useEffect, useState } from "react";
import { connOf, useApp } from "../state";
import { clock, copyText } from "../lib/format";
import { explain, logLine } from "../lib/mqrc";
import type { MqError } from "../lib/types";
import { Icon } from "./ui";

const RETRY_SECONDS = 30;

interface Props {
  connId: string;
  error: MqError;
  /** Connection-level failure: retries reconnect automatically on a countdown. */
  retryable?: boolean;
  onRetry?: () => void;
  queue?: string;
  hint?: string;
}

export default function ErrorView({ connId, error, retryable, onRetry, queue, hint }: Props) {
  const conn = useApp((s) => connOf(s, connId));
  const st = useApp((s) => s.status[connId]);
  const { connect, setOverlay } = useApp.getState();
  const [left, setLeft] = useState(RETRY_SECONDS);
  const ex = explain(error);

  const retry = () => {
    setLeft(RETRY_SECONDS);
    if (onRetry) onRetry();
    else void connect(connId);
  };

  useEffect(() => {
    if (!retryable) return;
    setLeft(RETRY_SECONDS);
    const t = setInterval(() => setLeft((v) => v - 1), 1000);
    return () => clearInterval(t);
  }, [retryable, st?.attempt]);

  useEffect(() => {
    if (retryable && left <= 0 && st?.state === "error") retry();
  }, [left]);

  if (!conn) return null;
  const details = [
    { k: "Host", v: `${conn.host}:${conn.port}` },
    { k: "Channel", v: conn.channel },
    { k: "Queue manager", v: conn.qmgr || "(default)" },
    ...(queue ? [{ k: "Queue", v: queue }] : []),
    ...(conn.user ? [{ k: "User", v: conn.user }] : []),
    ...(conn.tls.enabled ? [{ k: "Cipher spec", v: conn.tls.cipher }] : []),
    ...(conn.tls.enabled && conn.tls.truststore ? [{ k: "Truststore", v: conn.tls.truststore }] : []),
    { k: "Time", v: `${new Date().toISOString().slice(0, 10)} ${clock(st?.lastAttempt ?? new Date())}` },
  ];
  const editLabel = ex.edit === "credentials" ? "Edit credentials" : ex.edit === "tls" ? "Edit TLS settings" : "Edit connection";
  const editIcon = ex.edit === "credentials" ? "ph-key" : ex.edit === "tls" ? "ph-lock-simple" : "ph-pencil-simple";
  const copyDetails = () =>
    copyText([`MQRC ${error.code} ${error.name}`, ex.title, ...details.map((d) => `${d.k}: ${d.v}`), logLine(error), ...(error.tlsChain ?? []).map((c) => `${c.role}: ${c.dn} — ${c.status}`)].join("\n"));

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ width: 640, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "22px 24px 20px", display: "flex", gap: 16, borderBottom: "1px solid var(--line)" }}>
          <div style={{ width: 42, height: 42, flex: "none", borderRadius: 9, background: "var(--err-bg)", border: "1px solid var(--err-line)", color: "var(--err)", display: "grid", placeItems: "center", fontSize: 22 }}>
            <Icon name={ex.icon} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
              {error.code > 0 && <span className="mono" style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 3, background: "var(--err-bg)", border: "1px solid var(--err-line)", color: "var(--err)" }}>MQRC {error.code}</span>}
              <span className="mono" style={{ fontSize: 12, color: "var(--err)" }}>{error.name}</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{ex.title}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, textWrap: "pretty", lineHeight: 1.5 }}>{ex.desc}</div>
          </div>
        </div>
        {error.tlsChain && error.tlsChain.length > 0 && (
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)" }}>
            <div className="caps" style={{ marginBottom: 10 }}>CERTIFICATE CHAIN PRESENTED BY SERVER</div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 6, overflow: "hidden" }}>
              {error.tlsChain.map((c, i) => {
                const good = /trusted|in truststore|received/i.test(c.status) && !/not/i.test(c.status);
                const bad = /not in truststore/i.test(c.status);
                const color = good ? "var(--ok)" : bad ? "var(--err)" : "var(--faint)";
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "20px 110px minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "9px 12px", borderBottom: "1px solid var(--line-soft)", fontSize: 12 }}>
                    <Icon name={good ? "ph-check-circle" : bad ? "ph-x-circle" : "ph-question"} size={15} color={color} />
                    <span style={{ color: "var(--muted)" }}>{c.role}</span>
                    <span className="mono ellipsis" style={{ fontSize: 11.5 }} title={c.dn}>{c.dn}</span>
                    <span style={{ fontSize: 11.5, color }}>{c.status}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ padding: "16px 24px", display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", rowGap: 7, columnGap: 12, borderBottom: "1px solid var(--line)", fontSize: 12 }}>
          {details.map((d) => (
            <div key={d.k} style={{ display: "contents" }}>
              <span style={{ color: "var(--muted)" }}>{d.k}</span>
              <span className="mono ellipsis" style={{ fontSize: 12 }}>{d.v}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)" }}>
          {ex.causes.length > 0 && (
            <>
              <div className="caps" style={{ marginBottom: 9 }}>LIKELY CAUSES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
                {ex.causes.map((c) => (
                  <div key={c} style={{ display: "flex", gap: 9, fontSize: 12.5, lineHeight: 1.45 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--faint)", marginTop: 7, flex: "none" }} /><span>{c}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {hint && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>{hint}</div>}
          <div className="mono" style={{ padding: "9px 11px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 5, fontSize: 11.5, lineHeight: 1.5, color: "var(--muted)", wordBreak: "break-word" }}>{logLine(error)}</div>
        </div>
        <div style={{ padding: "14px 24px", display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn primary" onClick={retry} disabled={st?.state === "connecting"}><Icon name="ph-arrows-clockwise" />Retry</button>
          <button className="btn" onClick={() => setOverlay({ kind: "connection", connId })}><Icon name={editIcon} />{editLabel}</button>
          <button className="btn ghost" onClick={() => void copyDetails()}><Icon name="ph-copy" />Copy details</button>
          <div className="spacer" />
          {retryable && st?.state === "error" && (
            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Attempt {st.attempt} · next retry in {Math.max(0, left)} s</span>
          )}
          {st?.state === "connecting" && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Connecting…</span>}
        </div>
      </div>
    </div>
  );
}
