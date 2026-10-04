// Putting messages and reporting the outcome, shared by the Put dialog and one-click draft sends.
import { emptyMqmd, useApp } from "../state";
import { api, asMqError } from "./rpc";
import { copyText, shortId } from "./format";
import type { PutMqmd, PutProperty, Template } from "./types";

export async function putAndReport(connId: string, queue: string, body: { body?: string; bodyBase64?: string },
  mqmd: PutMqmd, properties: PutProperty[], count: number, label?: string): Promise<boolean> {
  const { showToast, openBrowse, refreshBrowse, loadQueues } = useApp.getState();
  try {
    const r = await api.put(connId, queue, body, mqmd, properties.filter((p) => p.name.trim()), count);
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
    for (const t of useApp.getState().tabs) {
      if (t.kind === "browse" && t.connId === connId && t.queue === queue) void refreshBrowse(t.id, "poll");
    }
    void loadQueues(connId);
    return true;
  } catch (e) {
    const err = asMqError(e);
    showToast({ tone: "err", title: `Put to ${queue} failed`, sub: `${err.code ? `MQRC ${err.code} ` : ""}${err.name}` });
    return false;
  }
}

/** The connection a draft goes to: its own if it still exists, else the one in focus. */
export function draftConnId(t: Template): string | null {
  const s = useApp.getState();
  if (t.connId && s.connections.some((c) => c.id === t.connId)) return t.connId;
  const active = s.tabs.find((x) => x.id === s.activeTab);
  return active?.connId ?? s.focusConn;
}

/** Sends a saved draft to its queue as-is, connecting first when needed. */
export async function sendDraft(t: Template): Promise<boolean> {
  const s = useApp.getState();
  const connId = draftConnId(t);
  if (!connId || !t.queue) {
    s.setOverlay(connId ? { kind: "put", connId, queue: t.queue ?? "", draftName: t.name } : { kind: "connection" });
    return false;
  }
  if (s.status[connId]?.state !== "connected" && !(await s.connect(connId))) {
    const err = useApp.getState().status[connId]?.error;
    s.showToast({ tone: "err", title: `Could not connect for "${t.name}"`, sub: err ? `${err.code ? `MQRC ${err.code} ` : ""}${err.name}` : undefined });
    return false;
  }
  return putAndReport(connId, t.queue, { body: t.body }, { ...emptyMqmd(s.settings.defaultCcsid), ...t.mqmd }, t.properties, t.count ?? 1, t.name);
}
