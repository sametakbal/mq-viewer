// Putting messages and reporting the outcome, shared by the Put dialog and one-click draft sends.
import { emptyMqmd, useApp } from "../state";
import { api, asMqError } from "./rpc";
import { copyText, shortId } from "./format";
import { hasTemplate, renderBodies } from "./template";
import type { MqError, PutMqmd, PutProperty, PutResult, PutTarget, Template } from "./types";

type Body = { body?: string; bodyBase64?: string };
type Payload = Body & { bodies?: string[] };

const errText = (err: MqError) => `${err.code ? `MQRC ${err.code} ` : ""}${err.name}`;

/** Expands {{ … }} expressions into one body per message; null after reporting a template error. */
function renderPayload(body: Body, count: number): Payload | null {
  if (body.body == null || !hasTemplate(body.body)) return body;
  try {
    return { bodies: renderBodies(body.body, count) };
  } catch (e) {
    useApp.getState().showToast({ tone: "err", title: "Template error", sub: (e as Error).message });
    return null;
  }
}

/** Refreshes what shows the queue a put just went to. */
function afterPut(connId: string, queue: string) {
  const { refreshBrowse, loadQueues, tabs } = useApp.getState();
  for (const t of tabs) {
    if (t.kind === "browse" && t.connId === connId && t.queue === queue) void refreshBrowse(t.id, "poll");
  }
  void loadQueues(connId);
}

export async function putAndReport(connId: string, queue: string, body: Body,
  mqmd: PutMqmd, properties: PutProperty[], count: number, label?: string): Promise<boolean> {
  const { showToast, openBrowse } = useApp.getState();
  const payload = renderPayload(body, count);
  if (!payload) return false;
  try {
    const r = await api.put(connId, queue, payload, mqmd, properties.filter((p) => p.name.trim()), count);
    const last = r.msgIds[r.msgIds.length - 1];
    const what = r.count > 1 ? `${r.count} messages` : "Message";
    showToast({
      tone: "ok",
      title: label ? `${label} → ${queue}` : `${what} sent to ${queue}`,
      sub: `${label ? `${what} · ` : ""}MsgId ${shortId(last)} · ${r.count} of ${r.count} · ${r.elapsedMs} ms`,
      actions: [
        { label: "Browse queue", run: () => openBrowse(connId, queue) },
        { label: "Copy MsgId", run: () => void copyText(r.msgIds.join("\n")) },
      ],
    });
    afterPut(connId, queue);
    return true;
  } catch (e) {
    showToast({ tone: "err", title: `Put to ${queue} failed`, sub: errText(asMqError(e)) });
    return false;
  }
}

/** Same target twice (same connection and queue, queue names ignoring case) collapses to one; blank queues drop out. */
export function uniqueTargets(targets: PutTarget[]): PutTarget[] {
  const seen = new Set<string>();
  return targets
    .map((t) => ({ connId: t.connId, queue: t.queue.trim() }))
    .filter((t) => {
      const key = `${t.connId}\u0000${t.queue.toUpperCase()}`;
      if (!t.queue || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Puts the same messages to every target and reports once. Targets on one connection go one after another,
 * different connections in parallel; a connection that is not up is connected first. Templated bodies are
 * rendered once, so every queue gets identical messages. Returns the targets that failed (empty when all went).
 */
export async function putToTargets(targets: PutTarget[], body: Body, mqmd: PutMqmd, properties: PutProperty[],
  count: number, label?: string): Promise<PutTarget[]> {
  const list = uniqueTargets(targets);
  if (list.length === 1) {
    const [t] = list;
    return (await putAndReport(t.connId, t.queue, body, mqmd, properties, count, label)) ? [] : list;
  }
  const payload = renderPayload(body, count);
  if (!payload) return list;
  const props = properties.filter((p) => p.name.trim());
  const s = useApp.getState();
  const connName = (id: string) => s.connections.find((c) => c.id === id)?.name ?? id;
  const multiConn = new Set(list.map((t) => t.connId)).size > 1;
  const where = (t: PutTarget) => (multiConn ? `${connName(t.connId)} › ${t.queue}` : t.queue);

  type Outcome = { t: PutTarget; r?: PutResult; err?: MqError };
  const byConn = new Map<string, PutTarget[]>();
  for (const t of list) byConn.set(t.connId, [...(byConn.get(t.connId) ?? []), t]);
  const started = performance.now();
  const outcomes = (await Promise.all([...byConn].map(async ([connId, ts]): Promise<Outcome[]> => {
    if (useApp.getState().status[connId]?.state !== "connected" && !(await useApp.getState().connect(connId))) {
      const err: MqError = useApp.getState().status[connId]?.error ?? { code: 0, cc: 2, name: "NOT_CONNECTED", message: "" };
      return ts.map((t) => ({ t, err }));
    }
    const out: Outcome[] = [];
    for (const t of ts) {
      try {
        out.push({ t, r: await api.put(connId, t.queue, payload, mqmd, props, count) });
        afterPut(connId, t.queue);
      } catch (e) {
        out.push({ t, err: asMqError(e) });
      }
    }
    return out;
  }))).flat();

  const ok = outcomes.filter((o) => o.r);
  const failed = outcomes.filter((o) => o.err);
  const what = count > 1 ? `${count} messages` : "Message";
  const msgIds = ok.flatMap((o) => o.r!.msgIds);
  const actions = msgIds.length ? [{ label: "Copy MsgIds", run: () => void copyText(msgIds.join("\n")) }] : [];
  if (!failed.length) {
    s.showToast({
      tone: "ok",
      title: `${label ? `${label} → ` : `${what} sent to `}${list.length} queues`,
      sub: `${ok.map((o) => where(o.t)).join(" · ")} · ${Math.round(performance.now() - started)} ms`,
      actions,
    });
  } else {
    s.showToast({
      tone: "err",
      title: ok.length ? `Sent to ${ok.length} of ${list.length} queues` : `Put to ${list.length} queues failed`,
      sub: failed.map((o) => `${where(o.t)}: ${errText(o.err!)}`).join(" · "),
      actions,
    });
  }
  return failed.map((o) => o.t);
}

/** The connection a draft goes to: its own if it still exists, else the one in focus. */
export function draftConnId(t: Template): string | null {
  const s = useApp.getState();
  if (t.connId && s.connections.some((c) => c.id === t.connId)) return t.connId;
  const active = s.tabs.find((x) => x.id === s.activeTab);
  return active?.connId ?? s.focusConn;
}

/** Every queue a draft goes to: its main queue on draftConnId, then its extra targets whose connection still exists. */
export function draftTargets(t: Template): PutTarget[] {
  const connId = draftConnId(t);
  const conns = useApp.getState().connections;
  const extra = (t.targets ?? []).filter((x) => conns.some((c) => c.id === x.connId));
  return uniqueTargets([...(connId && t.queue ? [{ connId, queue: t.queue }] : []), ...extra]);
}

/** Sends a saved draft to its queue(s) as-is, connecting first when needed. */
export async function sendDraft(t: Template): Promise<boolean> {
  const s = useApp.getState();
  const connId = draftConnId(t);
  if (!connId || !t.queue) {
    s.setOverlay(connId ? { kind: "put", connId, queue: t.queue ?? "", draftName: t.name } : { kind: "connection" });
    return false;
  }
  if (s.status[connId]?.state !== "connected" && !(await s.connect(connId))) {
    const err = useApp.getState().status[connId]?.error;
    s.showToast({ tone: "err", title: `Could not connect for "${t.name}"`, sub: err ? errText(err) : undefined });
    return false;
  }
  const mqmd = { ...emptyMqmd(s.settings.defaultCcsid), ...t.mqmd };
  const failed = await putToTargets(draftTargets(t), { body: t.body }, mqmd, t.properties, t.count ?? 1, t.name);
  return failed.length === 0;
}
