// Import/export through native file dialogs. Exports never contain secrets.
import { useApp } from "../state";
import { files, inTauri, pickOpen, pickSave } from "./rpc";
import type { Connection, Message } from "./types";
import { b64ToBytes } from "./format";

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

function notifyBrowserOnly() {
  useApp.getState().showToast({ tone: "err", title: "Not available in the browser preview", sub: "Run the desktop app (npm run tauri dev)" });
}

export async function importConnectionsFromFile() {
  if (!inTauri) return notifyBrowserOnly();
  const path = await pickOpen(JSON_FILTER);
  if (!path) return;
  const { showToast, importConnections } = useApp.getState();
  try {
    const parsed = JSON.parse(await files.readText(path));
    const list: Connection[] = Array.isArray(parsed) ? parsed : parsed.connections;
    if (!Array.isArray(list)) throw new Error("expected { connections: [...] }");
    const added = await importConnections(list);
    showToast({ tone: "ok", title: `Imported ${list.length} connection${list.length === 1 ? "" : "s"}`, sub: `${added} new · passwords are not part of exports` });
  } catch (e) {
    showToast({ tone: "err", title: "Import failed", sub: e instanceof Error ? e.message : String(e) });
  }
}

export async function exportConnectionsToFile(only?: Connection[]) {
  if (!inTauri) return notifyBrowserOnly();
  const list = only ?? useApp.getState().connections;
  const path = await pickSave(only?.length === 1 ? `${only[0].name || "connection"}.json` : "mq-viewer-connections.json", JSON_FILTER);
  if (!path) return;
  await files.writeText(path, JSON.stringify({ version: 1, connections: list }, null, 2));
  useApp.getState().showToast({ tone: "ok", title: `Exported ${list.length} connection${list.length === 1 ? "" : "s"}`, sub: path });
}

/** Messages as JSON with MQMD, properties and the payload (text when decodable, base64 always). */
export async function exportMessages(queue: string, messages: Message[]) {
  if (!inTauri) return notifyBrowserOnly();
  if (!messages.length) return;
  const path = await pickSave(`${queue}-${messages.length}-messages.json`, JSON_FILTER);
  if (!path) return;
  const out = messages.map((m) => ({
    seq: m.seq, msgId: m.msgId, correlId: m.correlId, putTime: m.putTime, format: m.format, ccsid: m.ccsid,
    priority: m.priority, persistence: m.persistence, size: m.size,
    mqmd: Object.fromEntries(m.mqmd.map((f) => [f.k, f.v])),
    properties: m.props, text: m.text, base64: m.base64, truncated: m.truncated,
  }));
  await files.writeText(path, JSON.stringify({ queue, exportedAt: new Date().toISOString(), messages: out }, null, 2));
  useApp.getState().showToast({ tone: "ok", title: `Exported ${messages.length} message${messages.length === 1 ? "" : "s"}`, sub: path });
}

export async function savePayload(m: Message) {
  if (!inTauri) return notifyBrowserOnly();
  const ext = m.kind === "json" ? "json" : m.kind === "xml" ? "xml" : m.kind === "text" ? "txt" : "bin";
  const path = await pickSave(`${m.msgId.slice(-16)}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
  if (!path) return;
  await files.writeBase64(path, m.base64);
  useApp.getState().showToast({ tone: "ok", title: "Payload saved", sub: `${b64ToBytes(m.base64).length} bytes · ${path}` });
}

export async function pickPayloadFile(): Promise<{ name: string; base64: string; text: string | null } | null> {
  if (!inTauri) {
    notifyBrowserOnly();
    return null;
  }
  const path = await pickOpen([{ name: "Payload", extensions: ["json", "xml", "txt", "bin", "dat", "*"] }]);
  if (!path) return null;
  const base64 = await files.readBase64(path);
  let text: string | null = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b64ToBytes(base64));
  } catch {
    text = null;
  }
  return { name: path.split(/[\\/]/).pop() ?? path, base64, text };
}

export async function pickKeystore(): Promise<string | null> {
  if (!inTauri) {
    notifyBrowserOnly();
    return null;
  }
  return pickOpen([{ name: "Keystore", extensions: ["p12", "pfx", "jks", "kdb"] }, { name: "All files", extensions: ["*"] }]);
}
