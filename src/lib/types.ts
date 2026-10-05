export type Env = "DEV" | "TEST" | "PROD";

export interface TlsConfig {
  enabled: boolean;
  cipher: string;
  keystore: string;
  truststore: string;
  certLabel: string;
  peerName: string;
}

/** Saved connection. Secrets never live here — they are in the OS keyring under the id. */
export interface Connection {
  id: string;
  name: string;
  folder: string;
  env: Env;
  color: number;
  host: string;
  port: number;
  qmgr: string;
  channel: string;
  user: string;
  savePassword: boolean;
  tls: TlsConfig;
  /** Queue opened by default (imported from the v1 app). */
  defaultQueue?: string;
  /** Queues added by name, listed when the user may not list queues through PCF. */
  queues?: string[];
}

export type Theme = "dark" | "light" | "system";
export type Interval = 2 | 5 | 10 | 30 | 0;

export interface Settings {
  theme: Theme;
  browseLimit: number;
  refreshInterval: Interval;
  defaultCcsid: number;
  /** Show CR, LF, SOH, STX, ETX… as visible markers in payloads. */
  showControlChars: boolean;
}

export interface PutProperty {
  name: string;
  type: string;
  value: string;
}

export interface PutMqmd {
  msgId: string;
  correlId: string;
  format: string;
  priority: number | null;
  persistence: "P" | "NP" | "Q";
  expiry: number | null;
  replyToQ: string;
  replyToQmgr: string;
  ccsid: number;
}

/** A saved sample message ("draft"); with a queue it can be sent in one click. */
export interface Template {
  name: string;
  body: string;
  mqmd: PutMqmd;
  properties: PutProperty[];
  queue?: string;
  connId?: string;
  count?: number;
}

export interface CertInfo {
  role: string;
  dn: string;
  issuer: string;
  status: string;
}

export interface MqError {
  code: number;
  name: string;
  cc: number;
  message: string;
  detail?: string | null;
  tlsChain?: CertInfo[] | null;
}

export interface QmgrInfo {
  qmgr: string;
  version: string;
  cmdLevel: number;
  platform: string | null;
  elapsedMs: number;
  tlsProtocol: string | null;
  tlsCipher: string | null;
  pcf: boolean;
}

export type QueueType = "Local" | "Alias" | "Remote" | "Model" | "Cluster" | "Unknown";

export interface QueueInfo {
  name: string;
  type: QueueType;
  depth: number | null;
  maxDepth: number | null;
  ipprocs: number | null;
  opprocs: number | null;
  target: string | null;
  description: string | null;
  getInhibited: boolean;
  putInhibited: boolean;
  /** What this user may do here; null when the list came from PCF (no per-queue check made). */
  access: QueueAccess | null;
  /** Reason name when a known queue could not be used at all (not found, not authorised). */
  error: string | null;
}

export interface QueueAccess {
  inquire: boolean;
  browse: boolean;
  put: boolean;
  get: boolean;
}

/**
 * "pcf": every queue the user may display. "probe": the user has no PCF access, so only the
 * connection's known queues were checked, one by one.
 */
export interface QueueList {
  source: "pcf" | "probe";
  queues: QueueInfo[];
}

export interface MqmdField {
  k: string;
  v: string;
  dec: string;
}

export interface Prop {
  k: string;
  t: string;
  v: string;
}

export type Kind = "json" | "xml" | "text" | "binary";

export interface Message {
  seq: number;
  msgId: string;
  correlId: string;
  putTime: string | null;
  format: string;
  size: number;
  priority: number;
  persistence: number;
  ccsid: number;
  charset: string;
  kind: Kind;
  preview: string | null;
  text: string | null;
  base64: string;
  truncated: boolean;
  mqmd: MqmdField[];
  props: Prop[];
  putAppl: string;
  userId: string;
  backoutCount: number;
}

export interface BrowseResult {
  queue: string;
  depth: number;
  maxDepth: number;
  offset: number;
  messages: Message[];
  more: boolean;
  browsedAt: string;
}

export interface PutResult {
  count: number;
  msgIds: string[];
  elapsedMs: number;
}

export interface DeleteResult {
  deleted: number;
  notFound: string[];
  depth: number;
}

export interface PurgeResult {
  removed: number;
  method: string;
}
