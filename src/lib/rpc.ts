import type {
  BrowseResult, Connection, DeleteResult, Message, MqError, PurgeResult, PutMqmd, PutProperty, PutResult,
  QmgrInfo, QueueList,
} from "./types";

/** True inside the Tauri webview; plain `vite` in a browser falls back to the mock backend. */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) return (await import("./mock")).mockBackend(cmd, args ?? {}) as Promise<T>;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export class MqCallError extends Error {
  constructor(public readonly err: MqError) {
    super(`${err.name}${err.code ? ` (${err.code})` : ""}: ${err.message}`);
  }
}

async function mq<T>(method: string, params: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>("mq_call", { method, params });
  } catch (e) {
    if (e && typeof e === "object" && "name" in e && "code" in e) throw new MqCallError(e as MqError);
    throw new MqCallError({ code: 0, name: "UNEXPECTED", cc: 2, message: String(e) });
  }
}

export function asMqError(e: unknown): MqError {
  if (e instanceof MqCallError) return e.err;
  return { code: 0, name: "UNEXPECTED", cc: 2, message: e instanceof Error ? e.message : String(e) };
}

/** Shape the sidecar expects; secrets are only included when the user typed them. */
export interface ConnSecrets {
  password?: string | null;
  keystorePassword?: string | null;
  truststorePassword?: string | null;
}

function wireConn(c: Connection, s: ConnSecrets = {}) {
  return {
    id: c.id, host: c.host, port: c.port, channel: c.channel, qmgr: c.qmgr, user: c.user,
    password: s.password ?? null,
    tls: {
      ...c.tls,
      keystorePassword: s.keystorePassword ?? null,
      truststorePassword: s.truststorePassword ?? null,
    },
  };
}

export const api = {
  test: (c: Connection, s?: ConnSecrets) => mq<QmgrInfo>("test", { conn: wireConn(c, s) }),
  connect: (c: Connection, s?: ConnSecrets) => mq<QmgrInfo>("connect", { conn: wireConn(c, s) }),
  disconnect: (connId: string) => mq<{ ok: boolean }>("disconnect", { connId }),
  listQueues: (connId: string, known: string[]) => mq<QueueList>("listQueues", { connId, known }),
  browse: (connId: string, queue: string, offset: number, limit: number) =>
    mq<BrowseResult>("browse", { connId, queue, offset, limit }),
  detail: (connId: string, queue: string, msgId: string) => mq<Message>("detail", { connId, queue, msgId }),
  put: (connId: string, queue: string, body: { body?: string; bodyBase64?: string; bodies?: string[] }, mqmd: PutMqmd,
    properties: PutProperty[], count: number) =>
    mq<PutResult>("put", { connId, queue, ...body, mqmd, properties, count }),
  deleteMessages: (connId: string, queue: string, msgIds: string[]) =>
    mq<DeleteResult>("delete", { connId, queue, msgIds }),
  purge: (connId: string, queue: string) => mq<PurgeResult>("purge", { connId, queue }),
};

export const store = {
  read: <T>(name: "connections" | "settings" | "templates") => invoke<T | null>("doc_read", { name }),
  write: (name: "connections" | "settings" | "templates", value: unknown) => invoke<void>("doc_write", { name, value }),
  legacyConnections: () => invoke<string | null>("legacy_connections"),
  dataDir: () => invoke<string>("data_dir"),
};

export const secrets = {
  get: (key: string) => invoke<string | null>("secret_get", { key }),
  set: (key: string, value: string) => invoke<void>("secret_set", { key, value }),
  delete: (key: string) => invoke<void>("secret_delete", { key }),
};

export const files = {
  readText: (path: string) => invoke<string>("file_read_text", { path }),
  readBase64: (path: string) => invoke<string>("file_read_base64", { path }),
  writeText: (path: string, contents: string) => invoke<void>("file_write_text", { path, contents }),
  writeBase64: (path: string, data: string) => invoke<void>("file_write_base64", { path, data }),
};

type Filter = { name: string; extensions: string[] };

export async function pickOpen(filters: Filter[]): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, directory: false, filters });
  return typeof r === "string" ? r : null;
}

export async function pickSave(defaultPath: string, filters: Filter[]): Promise<string | null> {
  if (!inTauri) {
    return null;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters });
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

/** Keyring keys for a connection's secrets. */
export const secretKey = {
  password: (id: string) => id,
  keystore: (id: string) => `${id}:keystore`,
  truststore: (id: string) => `${id}:truststore`,
};
