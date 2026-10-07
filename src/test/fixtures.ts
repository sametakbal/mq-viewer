// Builders for the shapes the unit tests pass around.
import type { BrowseResult, Connection, Message, MqError, QueueInfo } from "../lib/types";

export function conn(p: Partial<Connection> = {}): Connection {
  return {
    id: "c1", name: "Local", folder: "DEV", env: "DEV", color: 0, host: "localhost", port: 1414, qmgr: "QM1",
    channel: "DEV.APP.SVRCONN", user: "app", savePassword: true,
    tls: { enabled: false, cipher: "", keystore: "", truststore: "", certLabel: "", peerName: "" },
    ...p,
  };
}

export function message(msgId: string, p: Partial<Message> = {}): Message {
  return {
    seq: 1, msgId, correlId: "00", putTime: null, format: "MQSTR", size: 2, priority: 4, persistence: 1, ccsid: 1208,
    charset: "UTF-8", kind: "text", preview: "hi", text: "hi", base64: "aGk=", truncated: false,
    mqmd: [{ k: "Format", v: "MQSTR", dec: "" }], props: [], putAppl: "", userId: "", backoutCount: 0,
    ...p,
  };
}

export function queue(name: string, p: Partial<QueueInfo> = {}): QueueInfo {
  return {
    name, type: "Local", depth: 0, maxDepth: 5000, ipprocs: 0, opprocs: 0, target: null, description: null,
    getInhibited: false, putInhibited: false, access: null, error: null, ...p,
  };
}

export function browseResult(messages: Message[], p: Partial<BrowseResult> = {}): BrowseResult {
  return { queue: "Q", depth: messages.length, maxDepth: 5000, offset: 0, messages, more: false, browsedAt: "", ...p };
}

export const mqError = (code: number, name: string, message = "failed"): MqError => ({ code, name, cc: 2, message });
