// In-browser stand-in for the Tauri commands, used only when the UI runs under plain `vite`
// (no Tauri webview). It lets the screens be previewed and styled without a queue manager.
import type { BrowseResult, Connection, Message, QueueAccess, QueueInfo, QueueList } from "./types";

const docs: Record<string, unknown> = {};
const keyring: Record<string, string> = {};

// BigInt: the base is past 2^53, where plain numbers round every n to the same id.
const qmId = (n: number) => "414D5120504159" + "2E50524420202020" + (0x6a1f3c6502a41e20n + BigInt(n) * 7n).toString(16).toUpperCase().slice(-18).padStart(18, "0");

const queues: Record<string, Message[]> = {};
const queueInfo: QueueInfo[] = [
  q("ORDERS.EVENTS", 4512, 5000, 0, 3, "Orders event stream"),
  q("SETTLEMENT.BATCH", 38900, 50000, 1, 2),
  q("AUDIT.LOG", 21400, 100000, 2, 4),
  q("PAYMENTS.IN", 26, 5000, 3, 2),
  q("NOTIFY.EMAIL", 312, 5000, 1, 1),
  q("PAYMENTS.DLQ", 87, 10000, 0, 0),
  q("PAYMENTS.OUT", 0, 5000, 2, 3),
  { name: "PAYMENTS.API", type: "Alias", depth: null, maxDepth: null, ipprocs: null, opprocs: null, target: "PAYMENTS.IN", description: null, getInhibited: false, putInhibited: false, access: null, error: null },
  { name: "CLEARING.OUT", type: "Remote", depth: null, maxDepth: null, ipprocs: null, opprocs: null, target: "CLEARING.IN @ CLR.PRD.QM1", description: null, getInhibited: false, putInhibited: false, access: null, error: null },
  q("SYSTEM.DEAD.LETTER.QUEUE", 0, 5000, 0, 0),
];

/** "local-docker" has no PCF access: its queues are probed, with these rights (others: none). */
const NO_PCF = "c-local";
const probeAccess: Record<string, QueueAccess> = {
  "PAYMENTS.IN": { inquire: true, browse: true, put: true, get: true },
  "AUDIT.LOG": { inquire: true, browse: true, put: false, get: false },
  "NOTIFY.EMAIL": { inquire: false, browse: false, put: true, get: false },
};

function probe(name: string): QueueInfo {
  const info = queueInfo.find((x) => x.name === name);
  const none = { inquire: false, browse: false, put: false, get: false };
  if (!info) return { ...q(name, 0, 0, 0, 0), type: "Unknown", depth: null, maxDepth: null, ipprocs: null, opprocs: null, access: none, error: "MQRC_UNKNOWN_OBJECT_NAME" };
  const access = probeAccess[name] ?? none;
  if (!Object.values(access).some(Boolean)) return { ...info, access, error: "MQRC_NOT_AUTHORIZED" };
  const depth = queues[name]?.length ?? info.depth;
  return access.inquire
    ? { ...info, depth, access }
    : { ...info, type: "Unknown", depth: null, maxDepth: null, ipprocs: null, opprocs: null, description: null, access };
}

function q(name: string, depth: number, maxDepth: number, ipprocs: number, opprocs: number, description: string | null = null): QueueInfo {
  return { name, type: "Local", depth, maxDepth, ipprocs, opprocs, target: null, description, getInhibited: false, putInhibited: false, access: null, error: null };
}

function utf8b64(s: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

function makeMessage(i: number, raw: string, kind: Message["kind"]): Message {
  const msgId = qmId(i);
  const hasCorr = [3, 8, 14, 21].includes(i);
  const correlId = hasCorr ? Array.from({ length: 24 }, (_, k) => ((((i + 1) * (k + 7) * 2654435761) >>> 0) % 256).toString(16).padStart(2, "0").toUpperCase()).join("") : "0".repeat(48);
  const fmt = i === 12 ? "" : [2, 19, 23].includes(i) ? "MQHRF2" : "MQSTR";
  const size = new TextEncoder().encode(raw).length;
  const put = new Date(Date.UTC(2026, 9, 4, 7, 12, 4) + i * 97_000 + (i * 389) % 1000);
  return {
    seq: i + 1, msgId, correlId, putTime: put.toISOString(), format: fmt, size, priority: i === 6 ? 9 : i === 13 ? 0 : 4,
    persistence: i % 5 !== 2 ? 1 : 0, ccsid: 1208, charset: "UTF-8", kind, preview: raw.replace(/\s+/g, " ").slice(0, 240),
    text: raw, base64: utf8b64(raw), truncated: false,
    mqmd: [
      { k: "StrucId", v: "MD", dec: "" }, { k: "Version", v: "2", dec: "MQMD_VERSION_2" }, { k: "Report", v: "0", dec: "MQRO_NONE" },
      { k: "MsgType", v: hasCorr ? "1" : "8", dec: hasCorr ? "MQMT_REQUEST" : "MQMT_DATAGRAM" }, { k: "Expiry", v: "-1", dec: "MQEI_UNLIMITED" },
      { k: "Feedback", v: "0", dec: "MQFB_NONE" }, { k: "Encoding", v: "273", dec: "big-endian integers" },
      { k: "CodedCharSetId", v: "1208", dec: "UTF-8" }, { k: "Format", v: fmt, dec: fmt ? "" : "MQFMT_NONE" },
      { k: "Priority", v: "4", dec: "" }, { k: "Persistence", v: "1", dec: "MQPER_PERSISTENT" }, { k: "MsgId", v: msgId, dec: "" },
      { k: "CorrelId", v: correlId, dec: hasCorr ? "" : "MQCI_NONE" }, { k: "BackoutCount", v: "0", dec: "" },
      { k: "ReplyToQ", v: hasCorr ? "PAYMENTS.REPLY" : "", dec: "" }, { k: "ReplyToQMgr", v: "PAY.PRD.QM1", dec: "" },
      { k: "UserIdentifier", v: "svc_payapi", dec: "" }, { k: "PutApplType", v: "28", dec: "MQAT_JAVA" },
      { k: "PutApplName", v: "payments-api", dec: "" }, { k: "PutDate", v: "20261004", dec: "GMT" }, { k: "PutTime", v: "07120400", dec: "GMT" },
    ],
    props: [
      { k: "usr.tenantId", t: "String", v: "contoso-pay-nl" }, { k: "usr.schemaVersion", t: "Int32", v: "3" },
      { k: "usr.sourceSystem", t: "String", v: kind === "xml" ? "b2b-gateway" : "payments-api" },
    ],
    putAppl: "payments-api", userId: "svc_payapi", backoutCount: 0,
  };
}

function seed() {
  const names = [["Northwind Trading BV", "NL91ABNA0417164300"], ["Contoso GmbH", "DE89370400440532013000"], ["Fabrikam SARL", "FR1420041010050500013M02606"], ["Adatum AB", "SE4550000000058398257466"]];
  queues["PAYMENTS.IN"] = Array.from({ length: 26 }, (_, i) => {
    if ([4, 11, 19].includes(i)) {
      return makeMessage(i, `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn><GrpHdr><MsgId>B2B-${77120 + i}</MsgId><NbOfTxs>1</NbOfTxs><CtrlSum>48200.00</CtrlSum></GrpHdr></CstmrCdtTrfInitn></Document>`, "xml");
    }
    if ([7, 16].includes(i)) return makeMessage(i, `HEARTBEAT|PAYAPI|2026-10-04T09:${10 + i * 2}:00Z|NODE=pay-api-${(i % 4) + 1}|STATUS=OK`, "text");
    const d = names[i % 4], c = names[(i + 2) % 4];
    return makeMessage(i, JSON.stringify({ paymentId: "PMT-20261004-" + String(418 + i * 3).padStart(6, "0"), type: i % 3 ? "SEPA_CREDIT_TRANSFER" : "SEPA_INSTANT", amount: { value: [1250, 89.9, 15000, 342.17][i % 4], currency: "EUR" }, debtor: { name: d[0], iban: d[1] }, creditor: { name: c[0], iban: c[1] }, channel: i % 2 ? "API" : "BATCH", retry: i === 9 }), "json");
  });
  queues["PAYMENTS.OUT"] = [];
  queues["AUDIT.LOG"] = Array.from({ length: 6 }, (_, i) => makeMessage(200 + i, `AUDIT|user=svc_payapi|action=LOGIN|seq=${i}`, "text"));
  const conns: Connection[] = [
    conn("c-dev", "orders-dev", "DEV", "DEV", false),
    { ...conn("c-local", "local-docker", "DEV", "DEV", false), channel: "DEV.APP.SVRCONN", queues: ["PAYMENTS.IN", "AUDIT.LOG", "NOTIFY.EMAIL", "ORDERS.EVENTS"] },
    conn("c-test", "payments-test", "TEST", "TEST", true),
    conn("c-prod", "payments-prod-01", "PROD", "PROD", true),
  ];
  docs.connections = { version: 1, connections: conns };
}

function conn(id: string, name: string, folder: string, env: Connection["env"], tls: boolean): Connection {
  return {
    id, name, folder, env, color: env === "PROD" ? 0 : env === "TEST" ? 1 : 3, host: env === "PROD" ? "pay-mq-prd01.corp.internal" : "localhost",
    port: 1414, qmgr: env === "PROD" ? "PAY.PRD.QM1" : "QM1", channel: env === "PROD" ? "PAYAPI.SVRCONN" : "DEV.ADMIN.SVRCONN", user: "svc_payapi",
    savePassword: true, tls: { enabled: tls, cipher: "TLS_AES_256_GCM_SHA384", keystore: "~/certs/payapi-client.p12", truststore: "", certLabel: "", peerName: "" },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockBackend(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  if (!docs.connections) seed();
  await wait(120);
  switch (cmd) {
    case "doc_read": return docs[a.name as string] ?? null;
    case "doc_write": docs[a.name as string] = a.value; return null;
    case "legacy_connections": return null;
    case "data_dir": return "~/.mq-viewer";
    case "secret_get": return keyring[a.key as string] ?? null;
    case "secret_set": keyring[a.key as string] = a.value as string; return null;
    case "secret_delete": delete keyring[a.key as string]; return null;
    case "mq_call": return mqCall(a.method as string, a.params as Record<string, unknown>);
    default: throw new Error(`mock: ${cmd} is not available in the browser preview`);
  }
}

async function mqCall(method: string, p: Record<string, unknown>): Promise<unknown> {
  const fail = (code: number, name: string, message: string) => Promise.reject({ code, name, cc: 2, message });
  const need: Partial<Record<string, keyof QueueAccess>> = { browse: "browse", detail: "browse", put: "put", delete: "get", purge: "get" };
  const right = need[method];
  if (p.connId === NO_PCF && right && !probeAccess[p.queue as string]?.[right]) {
    return fail(2035, "MQRC_NOT_AUTHORIZED", "MQJE001: Completion Code '2', Reason '2035'.");
  }
  switch (method) {
    case "test":
    case "connect": {
      await wait(500);
      const c = p.conn as { id: string; qmgr: string };
      if (c.id === "c-test") return fail(2538, "MQRC_HOST_NOT_AVAILABLE", "MQJE001: Completion Code '2', Reason '2538'.");
      return { qmgr: c.qmgr, version: "9.4.0.5", cmdLevel: 940, platform: "MQPL_UNIX", elapsedMs: 184, tlsProtocol: "TLSv1.3", tlsCipher: "TLS_AES_256_GCM_SHA384", pcf: c.id !== NO_PCF };
    }
    case "disconnect": return { ok: true };
    case "listQueues": {
      if (p.connId === NO_PCF) {
        return { source: "probe", queues: [...new Set(p.known as string[])].map(probe) } satisfies QueueList;
      }
      return { source: "pcf", queues: queueInfo.map((x) => (queues[x.name] ? { ...x, depth: queues[x.name].length } : x)) } satisfies QueueList;
    }
    case "browse": {
      const msgs = queues[p.queue as string];
      if (!msgs) return fail(2085, "MQRC_UNKNOWN_OBJECT_NAME", "MQJE001: Completion Code '2', Reason '2085'.");
      const off = p.offset as number, lim = p.limit as number;
      const page = msgs.slice(off, off + lim).map((m, i) => ({ ...m, seq: off + i + 1 }));
      return { queue: p.queue as string, depth: msgs.length, maxDepth: 5000, offset: off, messages: page, more: off + lim < msgs.length, browsedAt: new Date().toISOString() } satisfies BrowseResult;
    }
    case "detail": return queues[p.queue as string]?.find((m) => m.msgId === p.msgId) ?? fail(2033, "MQRC_NO_MSG_AVAILABLE", "gone");
    case "put": {
      const list = (queues[p.queue as string] ??= []);
      const ids: string[] = [];
      const bodies = p.bodies as string[] | undefined;
      const count = bodies?.length ?? (p.count as number);
      for (let i = 0; i < count; i++) {
        const body = bodies?.[i] ?? (p.body as string) ?? "";
        const kind = body.trim().startsWith("{") ? "json" : body.trim().startsWith("<") ? "xml" : "text";
        const m = makeMessage(list.length + 100 + i, body, kind);
        m.putTime = new Date().toISOString();
        list.push(m);
        ids.push(m.msgId);
      }
      return { count, msgIds: ids, elapsedMs: 23 };
    }
    case "delete": {
      const ids = new Set(p.msgIds as string[]);
      const list = queues[p.queue as string] ?? [];
      const keep = list.filter((m) => !ids.has(m.msgId));
      queues[p.queue as string] = keep;
      return { deleted: list.length - keep.length, notFound: [], depth: keep.length };
    }
    case "purge": {
      const n = queues[p.queue as string]?.length ?? 0;
      queues[p.queue as string] = [];
      return { removed: n, method: "CLEAR QLOCAL" };
    }
    default: return fail(0, "INVALID_REQUEST", "Unknown method " + method);
  }
}
