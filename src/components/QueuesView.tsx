import { useMemo, useState } from "react";
import { connOf, useApp, type Tab } from "../state";
import { clock, n, wildcard } from "../lib/format";
import type { QueueInfo } from "../lib/types";
import ErrorView from "./ErrorView";
import { Empty, Icon, Segmented, Spinner, Switch } from "./ui";

type TypeFilter = "All" | "Local" | "Alias" | "Remote" | "Model";

function note(q: QueueInfo): { text: string; color: string } | null {
  if (q.type === "Local" && (q.depth ?? 0) > 0 && q.ipprocs === 0) return { text: "no consumers", color: "var(--err)" };
  if (/DEAD\.LETTER|\.DLQ$/.test(q.name)) return { text: "dead-letter", color: "var(--faint)" };
  if (q.getInhibited) return { text: "get disabled", color: "var(--warn)" };
  if (q.putInhibited) return { text: "put disabled", color: "var(--warn)" };
  return q.description ? { text: q.description, color: "var(--faint)" } : null;
}

const ICON: Record<string, string> = { Alias: "ph-arrow-bend-down-right", Remote: "ph-globe-simple", Model: "ph-copy-simple", Cluster: "ph-share-network" };

export default function QueuesView({ tab }: { tab: Tab }) {
  const st = useApp((s) => s.status[tab.connId]);
  const conn = useApp((s) => connOf(s, tab.connId));
  const { loadQueues, openBrowse } = useApp.getState();
  const [filter, setFilter] = useState("");
  const [hideSys, setHideSys] = useState(true);
  const [type, setType] = useState<TypeFilter>("All");

  const all = st?.queues ?? [];
  const sysCount = all.filter((q) => q.name.startsWith("SYSTEM.")).length;
  const rows = useMemo(() => {
    const m = wildcard(filter);
    return all
      .filter((q) => (!hideSys || !q.name.startsWith("SYSTEM.")) && (type === "All" || q.type === type) && m(q.name))
      .sort((a, b) => (b.depth ?? -1) - (a.depth ?? -1) || a.name.localeCompare(b.name));
  }, [all, filter, hideSys, type]);

  if (!conn) return null;
  if (st?.queuesError && !st.queues) {
    return <ErrorView connId={tab.connId} error={st.queuesError} onRetry={() => void loadQueues(tab.connId)} hint="You can still browse a queue by name from the search (Ctrl K)." />;
  }
  const loading = st?.state === "connecting" || (st?.queuesLoading && !st.queues);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Queues</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {st?.info?.qmgr ?? conn.qmgr} · {rows.length} shown{hideSys && sysCount ? ` · ${sysCount} SYSTEM.* hidden` : ""}{st?.queuesAt ? ` · refreshed ${clock(st.queuesAt)}` : ""}
          </div>
        </div>
        <button className="btn" onClick={() => void loadQueues(tab.connId)} disabled={st?.state !== "connected"}>
          {st?.queuesLoading ? <Spinner /> : <Icon name="ph-arrows-clockwise" />}Refresh
        </button>
      </div>
      <div style={{ height: 44, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderBottom: "1px solid var(--line)" }}>
        <div className="input on-panel" style={{ width: 280, gap: 7, padding: "0 9px", fontSize: 12 }}>
          <Icon name="ph-magnifying-glass" size={14} color="var(--faint)" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, e.g. PAYMENTS.*" spellCheck={false} />
        </div>
        <div onClick={() => setHideSys(!hideSys)} style={{ height: 30, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", border: "1px solid var(--line2)", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
          <Switch on={hideSys} onChange={setHideSys} />Hide SYSTEM.*
        </div>
        <Segmented<TypeFilter> options={(["All", "Local", "Alias", "Remote", "Model"] as const).map((k) => ({ value: k, label: k }))} value={type} onChange={setType} />
        <div className="spacer" />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
          <span style={{ width: 10, height: 4, borderRadius: 2, background: "var(--warn)" }} />≥ 70%
          <span style={{ width: 10, height: 4, borderRadius: 2, background: "var(--err)", marginLeft: 6 }} />≥ 85%
        </span>
      </div>
      <div className="q-grid col-head" style={{ height: 30, flex: "none", borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
        <span>QUEUE</span><span>TYPE</span><span>DEPTH / MAX</span>
        <span style={{ textAlign: "right", color: "var(--text)" }}>CURDEPTH ↓</span>
        <span style={{ textAlign: "right" }}>MAXDEPTH</span><span style={{ textAlign: "right" }}>IPPROCS</span><span style={{ textAlign: "right" }}>OPPROCS</span><span />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {loading && <div style={{ padding: 20, display: "flex", gap: 8, alignItems: "center", color: "var(--muted)" }}><Spinner />Loading queues…</div>}
        {!loading && rows.length === 0 && <Empty icon="ph-tray" title="No queues match">Change the filter or show SYSTEM.* queues.</Empty>}
        {rows.map((q) => <QueueRow key={q.name} q={q} onOpen={() => openBrowse(tab.connId, q.name)} />)}
      </div>
    </div>
  );
}

function QueueRow({ q, onOpen }: { q: QueueInfo; onOpen: () => void }) {
  const has = q.depth != null && !!q.maxDepth;
  const pct = has ? Math.round((q.depth! / q.maxDepth!) * 100) : 0;
  const col = pct >= 85 ? "var(--err)" : pct >= 70 ? "var(--warn)" : "var(--accent)";
  const nt = note(q);
  const browsable = q.type === "Local" || q.type === "Alias";
  return (
    <div className="q-grid hoverable" style={{ height: 36, borderBottom: "1px solid var(--line-soft)", fontSize: 12.5 }} onDoubleClick={() => browsable && onOpen()}>
      <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <Icon name={ICON[q.type] ?? "ph-tray"} size={15} color="var(--faint)" />
        <span className="mono" style={{ fontSize: 12 }}>{q.name}</span>
        {nt && <span className="ellipsis" style={{ fontSize: 11.5, color: nt.color }}>{nt.text}</span>}
      </span>
      <span><span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 3, background: "var(--raised)", border: "1px solid var(--line)", color: "var(--muted)" }}>{q.type}</span></span>
      <span style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 28 }}>
        {q.depth != null && has ? (
          <>
            <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--raised)", border: "1px solid var(--line)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.max(pct, q.depth > 0 ? 1 : 0)}%`, background: col }} />
            </span>
            <span className="mono" style={{ width: 36, textAlign: "right", fontSize: 11, color: pct >= 70 ? col : "var(--muted)" }}>{pct}%</span>
          </>
        ) : (
          <span className="mono ellipsis" style={{ fontSize: 11.5, color: "var(--faint)" }}>{q.target ? `→ ${q.target}` : ""}</span>
        )}
      </span>
      <span className="mono" style={{ textAlign: "right", fontSize: 12, color: pct >= 85 ? "var(--err)" : pct >= 70 ? "var(--warn)" : "var(--text)" }}>{q.depth == null ? "—" : n(q.depth)}</span>
      <span className="mono" style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{q.maxDepth == null ? "—" : n(q.maxDepth)}</span>
      <span className="mono" style={{ textAlign: "right", fontSize: 12, color: q.ipprocs === 0 && (q.depth ?? 0) > 0 ? "var(--err)" : "var(--text)" }}>{q.ipprocs ?? "—"}</span>
      <span className="mono" style={{ textAlign: "right", fontSize: 12 }}>{q.opprocs ?? "—"}</span>
      <span style={{ justifySelf: "end" }}>
        {browsable && <button className="btn outline xs" onClick={onOpen}><Icon name="ph-eye" size={13} />Browse</button>}
      </span>
    </div>
  );
}
