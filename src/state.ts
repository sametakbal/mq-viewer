import { create } from "zustand";
import { api, asMqError, secretKey, secrets, store, type ConnSecrets } from "./lib/rpc";
import { uid } from "./lib/format";
import type {
  BrowseResult, Connection, Message, MqError, PutMqmd, PutProperty, QmgrInfo, QueueAccess, QueueInfo, QueueList, Settings,
  Template,
} from "./lib/types";

export type ConnState = "disconnected" | "connecting" | "connected" | "error";

export interface ConnStatus {
  state: ConnState;
  info?: QmgrInfo;
  error?: MqError;
  attempt: number;
  lastAttempt?: Date;
  /** Queues the user can work with (probed queues without any access are left out). */
  queues?: QueueInfo[];
  /** "probe": no PCF access, `queues` are only the connection's known queues. */
  queuesSource?: QueueList["source"];
  /** Known queues that could not be used: not found or not authorised. */
  queuesHidden?: QueueInfo[];
  queuesError?: MqError;
  queuesLoading?: boolean;
  queuesAt?: Date;
}

export interface Tab {
  id: string;
  kind: "queues" | "browse";
  connId: string;
  queue?: string;
}

export interface Filters {
  format: string; // "" = any
  kind: string; // "" = any
  correlOnly: boolean;
}

export type DetailTab = "payload" | "mqmd" | "props";
export type PayloadView = "text" | "json" | "xml" | "hex";

export interface BrowseState {
  loading: boolean;
  loadingMore: boolean;
  error?: MqError;
  depth: number;
  maxDepth: number;
  messages: Message[];
  more: boolean;
  browsedAt?: Date;
  selected: string | null;
  checked: Record<string, true>;
  fresh: Record<string, true>;
  search: string;
  regex: boolean;
  filters: Filters;
  auto: boolean;
  pollErrors: number;
  detailTab: DetailTab;
  pview: PayloadView | null;
  detailClosed: boolean;
}

export interface PutDraft {
  body: string;
  bodyBase64?: string;
  fileName?: string;
  mqmd: PutMqmd;
  properties: PutProperty[];
  count: number;
}

export type Overlay =
  | { kind: "connection"; connId?: string }
  | { kind: "put"; connId: string; queue: string; draft?: Partial<PutDraft>; draftName?: string }
  | { kind: "purge"; connId: string; queue: string }
  | { kind: "delete"; connId: string; queue: string; msgIds: string[] }
  | { kind: "settings" }
  | { kind: "palette" };

export interface Toast {
  id: number;
  tone: "ok" | "err";
  title: string;
  sub?: string;
  actions?: { label: string; run: () => void }[];
}

export const DEFAULT_SETTINGS: Settings = { theme: "dark", browseLimit: 50, refreshInterval: 5, defaultCcsid: 1208, showControlChars: false };

export const emptyMqmd = (ccsid = 1208): PutMqmd => ({
  msgId: "", correlId: "", format: "MQSTR", priority: null, persistence: "Q", expiry: null, replyToQ: "", replyToQmgr: "", ccsid,
});

export function newConnection(): Connection {
  return {
    id: uid(), name: "", folder: "DEV", env: "DEV", color: 3, host: "localhost", port: 1414, qmgr: "", channel: "DEV.APP.SVRCONN",
    user: "", savePassword: true,
    tls: { enabled: false, cipher: "*TLS13ORHIGHER", keystore: "", truststore: "", certLabel: "", peerName: "" },
  };
}

function newBrowse(auto: boolean): BrowseState {
  return {
    loading: true, loadingMore: false, depth: 0, maxDepth: 0, messages: [], more: false, selected: null, checked: {}, fresh: {},
    search: "", regex: false, filters: { format: "", kind: "", correlOnly: false }, auto, pollErrors: 0,
    detailTab: "payload", pview: null, detailClosed: false,
  };
}

interface AppState {
  ready: boolean;
  connections: Connection[];
  settings: Settings;
  templates: Template[];
  status: Record<string, ConnStatus>;
  tabs: Tab[];
  activeTab: string | null;
  browse: Record<string, BrowseState>;
  overlay: Overlay | null;
  toast: Toast | null;
  /** Connection highlighted when no tab is open (sidebar selection). */
  focusConn: string | null;

  init: () => Promise<void>;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  saveTemplates: (t: Template[]) => Promise<void>;
  saveConnection: (c: Connection, s: ConnSecrets) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  importConnections: (list: Connection[]) => Promise<number>;

  connect: (id: string) => Promise<boolean>;
  disconnect: (id: string) => Promise<void>;
  loadQueues: (id: string) => Promise<void>;
  /** Checks a queue by name and, when the user can use it, remembers it for the connection. */
  addQueue: (connId: string, queue: string) => Promise<MqError | null>;
  removeQueue: (connId: string, queue: string) => Promise<void>;

  openQueues: (connId: string) => void;
  openBrowse: (connId: string, queue: string) => void;
  activate: (tabId: string) => void;
  closeTab: (tabId: string) => void;

  refreshBrowse: (tabId: string, mode?: "reset" | "more" | "poll") => Promise<void>;
  patchBrowse: (tabId: string, patch: Partial<BrowseState> | ((b: BrowseState) => Partial<BrowseState>)) => void;
  replaceMessage: (tabId: string, m: Message) => void;

  setOverlay: (o: Overlay | null) => void;
  showToast: (t: Omit<Toast, "id">) => void;
  closeToast: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Secrets typed for connections that must not be saved; kept in memory for this session only. */
const sessionSecrets = new Map<string, ConnSecrets>();

export const useApp = create<AppState>((set, get) => {
  const setStatus = (id: string, patch: Partial<ConnStatus>) =>
    set((s) => ({ status: { ...s.status, [id]: { ...(s.status[id] ?? { state: "disconnected", attempt: 0 }), ...patch } } }));

  const persistConnections = (connections: Connection[]) => store.write("connections", { version: 1, connections });

  return {
    ready: false,
    connections: [],
    settings: DEFAULT_SETTINGS,
    templates: [],
    status: {},
    tabs: [],
    activeTab: null,
    browse: {},
    overlay: null,
    toast: null,
    focusConn: null,

    async init() {
      const [conns, settings, templates] = await Promise.all([
        store.read<{ connections: Connection[] }>("connections"),
        store.read<Settings>("settings"),
        store.read<{ templates: Template[] }>("templates"),
      ]);
      let connections = conns?.connections ?? [];
      if (!conns) {
        const legacy = await store.legacyConnections().catch(() => null);
        if (legacy) {
          connections = await importLegacy(legacy);
          if (connections.length) await persistConnections(connections);
        }
      }
      set({
        ready: true, connections, settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) }, templates: templates?.templates ?? [],
        focusConn: connections[0]?.id ?? null,
      });
    },

    async saveSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      await store.write("settings", settings);
    },

    async saveTemplates(templates) {
      set({ templates });
      await store.write("templates", { templates });
    },

    async saveConnection(c, s) {
      const list = get().connections;
      const exists = list.some((x) => x.id === c.id);
      const connections = exists ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c];
      if (c.savePassword) {
        if (s.password) await secrets.set(secretKey.password(c.id), s.password);
        if (s.keystorePassword) await secrets.set(secretKey.keystore(c.id), s.keystorePassword);
        if (s.truststorePassword) await secrets.set(secretKey.truststore(c.id), s.truststorePassword);
        sessionSecrets.delete(c.id);
      } else {
        await forgetSecrets(c.id);
        if (s.password || s.keystorePassword || s.truststorePassword) sessionSecrets.set(c.id, s);
      }
      set({ connections, focusConn: c.id });
      await persistConnections(connections);
      // Settings changed under a live connection: reconnect so the next call uses them.
      if (exists && get().status[c.id]?.state === "connected") {
        await get().disconnect(c.id);
        void get().connect(c.id);
      }
    },

    async deleteConnection(id) {
      await get().disconnect(id).catch(() => undefined);
      await forgetSecrets(id);
      sessionSecrets.delete(id);
      const connections = get().connections.filter((c) => c.id !== id);
      set((s) => {
        const tabs = s.tabs.filter((t) => t.connId !== id);
        return {
          connections, tabs, activeTab: tabs.some((t) => t.id === s.activeTab) ? s.activeTab : tabs[0]?.id ?? null,
          focusConn: connections[0]?.id ?? null,
        };
      });
      await persistConnections(connections);
    },

    async importConnections(incoming) {
      const list = [...get().connections];
      let added = 0;
      for (const raw of incoming) {
        const c: Connection = { ...newConnection(), ...raw, tls: { ...newConnection().tls, ...(raw.tls ?? {}) } };
        const i = list.findIndex((x) => x.id === c.id || x.name === c.name);
        if (i >= 0) list[i] = { ...c, id: list[i].id };
        else {
          list.push(c);
          added++;
        }
      }
      set({ connections: list });
      await persistConnections(list);
      return added;
    },

    async connect(id) {
      const c = get().connections.find((x) => x.id === id);
      if (!c) return false;
      const prev = get().status[id];
      setStatus(id, { state: "connecting", error: undefined, attempt: (prev?.attempt ?? 0) + 1, lastAttempt: new Date() });
      try {
        const info = await api.connect(c, sessionSecrets.get(id));
        setStatus(id, { state: "connected", info, error: undefined, attempt: 0 });
        void get().loadQueues(id);
        return true;
      } catch (e) {
        setStatus(id, { state: "error", error: asMqError(e) });
        return false;
      }
    },

    async disconnect(id) {
      setStatus(id, { state: "disconnected", info: undefined, error: undefined, queues: undefined, queuesHidden: undefined, queuesSource: undefined, attempt: 0 });
      await api.disconnect(id).catch(() => undefined);
    },

    async loadQueues(id) {
      const c = get().connections.find((x) => x.id === id);
      setStatus(id, { queuesLoading: true });
      try {
        const list = await api.listQueues(id, c ? knownQueues(c) : []);
        setStatus(id, {
          queues: list.queues.filter((q) => !q.error), queuesHidden: list.queues.filter((q) => q.error),
          queuesSource: list.source, queuesError: undefined, queuesLoading: false, queuesAt: new Date(),
        });
      } catch (e) {
        setStatus(id, { queuesError: asMqError(e), queuesLoading: false, queuesAt: new Date() });
      }
    },

    async addQueue(connId, name) {
      const queue = name.trim();
      if (!queue) return null;
      let probed: QueueInfo | undefined;
      try {
        probed = (await api.listQueues(connId, [queue])).queues.find((q) => q.name === queue);
      } catch (e) {
        return asMqError(e);
      }
      if (!probed || probed.error) {
        const name = probed?.error ?? "MQRC_UNKNOWN_OBJECT_NAME";
        return {
          code: name === "MQRC_NOT_AUTHORIZED" ? 2035 : 2085, name, cc: 2,
          message: name === "MQRC_NOT_AUTHORIZED" ? `You have no access to ${queue}.` : `${queue} does not exist on this queue manager.`,
        };
      }
      await rememberQueue(connId, queue);
      const st = get().status[connId];
      setStatus(connId, {
        queues: [...(st?.queues ?? []).filter((q) => q.name !== queue), probed],
        queuesHidden: st?.queuesHidden?.filter((q) => q.name !== queue),
      });
      return null;
    },

    async removeQueue(connId, queue) {
      const connections = get().connections.map((c) =>
        c.id !== connId ? c : {
          ...c, queues: (c.queues ?? []).filter((q) => q !== queue), defaultQueue: c.defaultQueue === queue ? undefined : c.defaultQueue,
        });
      set({ connections });
      await persistConnections(connections);
      const st = get().status[connId];
      setStatus(connId, { queues: st?.queues?.filter((q) => q.name !== queue), queuesHidden: st?.queuesHidden?.filter((q) => q.name !== queue) });
    },

    openQueues(connId) {
      const existing = get().tabs.find((t) => t.kind === "queues" && t.connId === connId);
      if (existing) {
        set({ activeTab: existing.id, focusConn: connId });
      } else {
        const tab: Tab = { id: uid(), kind: "queues", connId };
        set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id, focusConn: connId }));
      }
      if (get().status[connId]?.state !== "connected") void get().connect(connId);
    },

    openBrowse(connId, queue) {
      const existing = get().tabs.find((t) => t.kind === "browse" && t.connId === connId && t.queue === queue);
      if (existing) {
        set({ activeTab: existing.id, focusConn: connId });
        return;
      }
      const tab: Tab = { id: uid(), kind: "browse", connId, queue };
      set((s) => ({
        tabs: [...s.tabs, tab], activeTab: tab.id, focusConn: connId,
        browse: { ...s.browse, [tab.id]: newBrowse(s.settings.refreshInterval > 0) },
      }));
      void (async () => {
        if (get().status[connId]?.state !== "connected" && !(await get().connect(connId))) {
          get().patchBrowse(tab.id, { loading: false, error: get().status[connId]?.error });
          return;
        }
        await get().refreshBrowse(tab.id, "reset");
      })();
    },

    activate(tabId) {
      const t = get().tabs.find((x) => x.id === tabId);
      set({ activeTab: tabId, focusConn: t?.connId ?? get().focusConn });
    },

    closeTab(tabId) {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === tabId);
        const tabs = s.tabs.filter((t) => t.id !== tabId);
        const { [tabId]: _gone, ...browse } = s.browse;
        void _gone;
        const activeTab = s.activeTab === tabId ? tabs[Math.min(idx, tabs.length - 1)]?.id ?? null : s.activeTab;
        return { tabs, browse, activeTab };
      });
    },

    async refreshBrowse(tabId, mode = "reset") {
      const tab = get().tabs.find((t) => t.id === tabId);
      const b = get().browse[tabId];
      if (!tab?.queue || !b) return;
      const limit = get().settings.browseLimit;
      if (mode === "reset") get().patchBrowse(tabId, { loading: b.messages.length === 0, error: undefined });
      if (mode === "more") get().patchBrowse(tabId, { loadingMore: true });

      const offset = mode === "more" ? b.messages.length : 0;
      const count = mode === "poll" ? Math.max(limit, b.messages.length) : limit;
      let res: BrowseResult;
      try {
        if (get().status[tab.connId]?.state !== "connected" && !(await get().connect(tab.connId))) {
          throw get().status[tab.connId]?.error ?? new Error("not connected");
        }
        res = await api.browse(tab.connId, tab.queue, offset, count);
      } catch (e) {
        const err = "code" in (e as object) && "name" in (e as object) ? (e as MqError) : asMqError(e);
        if (mode === "poll") {
          const pollErrors = (get().browse[tabId]?.pollErrors ?? 0) + 1;
          get().patchBrowse(tabId, pollErrors >= 3 ? { pollErrors: 0, auto: false } : { pollErrors });
          if (pollErrors >= 3) {
            get().showToast({ tone: "err", title: "Auto-refresh stopped", sub: `${tab.queue} · ${err.name} after 3 failed refreshes` });
          }
        } else {
          get().patchBrowse(tabId, { loading: false, loadingMore: false, error: err });
        }
        return;
      }

      // Without PCF the list only holds known queues: remember one that was opened by name.
      const st = get().status[tab.connId];
      if (st?.queuesSource === "probe" && !st.queues?.some((q) => q.name === tab.queue)) {
        await rememberQueue(tab.connId, tab.queue);
        void get().loadQueues(tab.connId);
      }

      // Keep the sidebar/queue list depth in step with what browsing just saw.
      const queues = get().status[tab.connId]?.queues;
      if (queues && res.depth >= 0 && queues.some((q) => q.name === tab.queue && q.depth !== res.depth)) {
        setStatus(tab.connId, { queues: queues.map((q) => (q.name === tab.queue ? { ...q, depth: res.depth } : q)) });
      }

      get().patchBrowse(tabId, (cur) => {
        const messages = mode === "more" ? [...cur.messages, ...res.messages] : res.messages;
        const ids = new Set(messages.map((m) => m.msgId));
        const before = new Set(cur.messages.map((m) => m.msgId));
        const fresh: Record<string, true> = {};
        if (mode === "poll") for (const m of res.messages) if (!before.has(m.msgId)) fresh[m.msgId] = true;
        const checked: Record<string, true> = {};
        for (const k of Object.keys(cur.checked)) if (ids.has(k)) checked[k] = true;
        let selected = cur.selected && ids.has(cur.selected) ? cur.selected : null;
        if (!selected && mode === "reset") selected = messages[0]?.msgId ?? null;
        return {
          loading: false, loadingMore: false, error: undefined, messages, more: res.more, depth: res.depth,
          maxDepth: res.maxDepth, browsedAt: new Date(), checked, fresh, selected, pollErrors: 0,
        };
      });
    },

    patchBrowse(tabId, patch) {
      set((s) => {
        const cur = s.browse[tabId];
        if (!cur) return {};
        const p = typeof patch === "function" ? patch(cur) : patch;
        return { browse: { ...s.browse, [tabId]: { ...cur, ...p } } };
      });
    },

    replaceMessage(tabId, m) {
      get().patchBrowse(tabId, (cur) => ({ messages: cur.messages.map((x) => (x.msgId === m.msgId ? { ...m, seq: x.seq } : x)) }));
    },

    setOverlay(overlay) {
      set({ overlay });
    },

    showToast(t) {
      clearTimeout(toastTimer);
      const toast = { ...t, id: Date.now() };
      set({ toast });
      toastTimer = setTimeout(() => {
        if (get().toast?.id === toast.id) set({ toast: null });
      }, 6000);
    },

    closeToast() {
      set({ toast: null });
    },
  };

  async function rememberQueue(connId: string, queue: string) {
    const c = get().connections.find((x) => x.id === connId);
    if (!c || knownQueues(c).includes(queue)) return;
    const connections = get().connections.map((x) => (x.id === connId ? { ...x, queues: [...(x.queues ?? []), queue] } : x));
    set({ connections });
    await persistConnections(connections);
  }
});

/** Queues checked one by one when the user may not list queues through PCF. */
export function knownQueues(c: Connection): string[] {
  return [...new Set([c.defaultQueue, ...(c.queues ?? [])].filter((q): q is string => !!q))];
}

/** What the user may do on a queue; null when unknown (PCF list), in which case nothing is held back. */
export function queueAccess(s: AppState, connId: string, queue: string): QueueAccess | null {
  return s.status[connId]?.queues?.find((q) => q.name === queue)?.access ?? null;
}

async function forgetSecrets(id: string) {
  await Promise.all([
    secrets.delete(secretKey.password(id)), secrets.delete(secretKey.keystore(id)), secrets.delete(secretKey.truststore(id)),
  ]).catch(() => undefined);
}

/** v1 stored `connection.N.field=value` lines in ~/.mq-viewer/connections.properties. */
async function importLegacy(text: string): Promise<Connection[]> {
  const byIndex = new Map<string, Record<string, string>>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    const m = /^connection\.(\d+)\.(\w+)$/.exec(line.slice(0, eq).trim());
    if (eq <= 0 || !m) continue;
    const rec = byIndex.get(m[1]) ?? {};
    rec[m[2]] = line.slice(eq + 1).trim();
    byIndex.set(m[1], rec);
  }
  const out: Connection[] = [];
  for (const r of byIndex.values()) {
    const c = newConnection();
    c.name = r.name || `${r.host}:${r.port}/${r.queueManager}`;
    c.host = r.host || c.host;
    c.port = Number(r.port) || 1414;
    c.channel = r.channel || c.channel;
    c.qmgr = r.queueManager || "";
    c.user = r.username || "";
    c.defaultQueue = r.queueName || undefined;
    c.folder = "Imported";
    if (r.password) await secrets.set(secretKey.password(c.id), r.password).catch(() => undefined);
    out.push(c);
  }
  return out;
}

/** Selectors used in several components. */
export const activeTabOf = (s: AppState) => s.tabs.find((t) => t.id === s.activeTab) ?? null;
export const connOf = (s: AppState, id: string | null | undefined) => s.connections.find((c) => c.id === id) ?? null;
