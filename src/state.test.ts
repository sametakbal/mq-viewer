import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MqCallError } from "./lib/rpc";
import type { Connection, Settings } from "./lib/types";
import {
  activeTabOf, connOf, DEFAULT_SETTINGS, emptyMqmd, knownQueues, newConnection, queueAccess, useApp, type BrowseState,
} from "./state";
import { browseResult, conn, message, mqError, queue } from "./test/fixtures";

const h = vi.hoisted(() => ({
  api: { connect: vi.fn(), disconnect: vi.fn(), listQueues: vi.fn(), browse: vi.fn() },
  store: { read: vi.fn(), write: vi.fn(), legacyConnections: vi.fn() },
  secrets: { set: vi.fn(), delete: vi.fn() },
}));
vi.mock("./lib/rpc", async (importOriginal) => ({ ...(await importOriginal<typeof import("./lib/rpc")>()), ...h }));

const initial = useApp.getState();
const S = () => useApp.getState();
const info = { qmgr: "QM1", version: "10", cmdLevel: 1000, platform: null, elapsedMs: 1, tlsProtocol: null, tlsCipher: null, pcf: true };
const flush = () => new Promise((r) => setTimeout(r, 0));
const persisted = () => h.store.write.mock.calls.filter((c) => c[0] === "connections").at(-1)?.[1].connections as Connection[];

beforeEach(() => {
  useApp.setState(initial, true);
  for (const group of Object.values(h)) for (const f of Object.values(group)) f.mockReset().mockResolvedValue(undefined);
  h.api.connect.mockResolvedValue(info);
  h.api.listQueues.mockResolvedValue({ source: "pcf", queues: [] });
});
afterEach(() => vi.useRealTimers());

describe("helpers", () => {
  it("builds defaults", () => {
    expect(emptyMqmd()).toMatchObject({ format: "MQSTR", persistence: "Q", ccsid: 1208 });
    expect(emptyMqmd(819).ccsid).toBe(819);
    const a = newConnection(), b = newConnection();
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ host: "localhost", port: 1414, channel: "DEV.APP.SVRCONN" });
  });

  it("knownQueues de-duplicates the default and added queues", () => {
    expect(knownQueues(conn({ defaultQueue: "A", queues: ["A", "B", ""] }))).toEqual(["A", "B"]);
    expect(knownQueues(conn())).toEqual([]);
  });

  it("selectors", () => {
    const access = { inquire: true, browse: true, put: false, get: false };
    useApp.setState({
      connections: [conn()], tabs: [{ id: "t", kind: "queues", connId: "c1" }], activeTab: "t",
      status: { c1: { state: "connected", attempt: 0, queues: [queue("Q", { access })] } },
    });
    expect(activeTabOf(S())?.id).toBe("t");
    useApp.setState({ activeTab: "nope" });
    expect(activeTabOf(S())).toBeNull();
    expect(connOf(S(), "c1")?.id).toBe("c1");
    expect(connOf(S(), undefined)).toBeNull();
    expect(queueAccess(S(), "c1", "Q")).toEqual(access);
    expect(queueAccess(S(), "c1", "X")).toBeNull();
    expect(queueAccess(S(), "zz", "Q")).toBeNull();
  });
});

describe("init", () => {
  it("loads saved documents and merges settings with defaults", async () => {
    h.store.read.mockImplementation(async (name: string) =>
      name === "connections" ? { connections: [conn()] } : name === "settings" ? { theme: "light" } : { templates: [{ name: "d" }] });
    await S().init();
    expect(S()).toMatchObject({ ready: true, focusConn: "c1", templates: [{ name: "d" }] });
    expect(S().settings).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
    expect(h.store.legacyConnections).not.toHaveBeenCalled();
  });

  it("starts empty", async () => {
    h.store.read.mockResolvedValue(null);
    h.store.legacyConnections.mockRejectedValue(new Error("no file"));
    await S().init();
    expect(S()).toMatchObject({ ready: true, connections: [], templates: [], focusConn: null, settings: DEFAULT_SETTINGS });
    expect(h.store.write).not.toHaveBeenCalled();
  });

  it("imports v1 connections.properties once", async () => {
    h.store.read.mockResolvedValue(null);
    h.secrets.set.mockRejectedValueOnce(new Error("keyring locked"));
    h.store.legacyConnections.mockResolvedValue([
      "# comment", "", "connection.0.name=Old", "connection.0.host=mq1", "connection.0.port=1415", "connection.0.channel=CH",
      "connection.0.queueManager=QMA", "connection.0.username=u", "connection.0.password=p", "connection.0.queueName=IN",
      "connection.1.host=mq2", "connection.1.port=x", "connection.1.queueManager=QMB", "connection.1.password=q",
      "garbage", "=nokey", "other.0.x=1",
    ].join("\r\n"));
    await S().init();
    const [a, b] = S().connections;
    expect(a).toMatchObject({ name: "Old", host: "mq1", port: 1415, channel: "CH", qmgr: "QMA", user: "u", defaultQueue: "IN", folder: "Imported" });
    expect(b).toMatchObject({ name: "mq2:x/QMB", host: "mq2", port: 1414, channel: "DEV.APP.SVRCONN", qmgr: "QMB", user: "", defaultQueue: undefined });
    expect(h.secrets.set).toHaveBeenCalledWith(a.id, "p");
    expect(h.secrets.set).toHaveBeenCalledWith(b.id, "q");
    expect(persisted()).toHaveLength(2);
  });

  it("does not persist an empty legacy file", async () => {
    h.store.read.mockResolvedValue(null);
    h.store.legacyConnections.mockResolvedValue("# nothing");
    await S().init();
    expect(h.store.write).not.toHaveBeenCalled();
  });
});

describe("settings and templates", () => {
  it("saves both", async () => {
    await S().saveSettings({ browseLimit: 10 } as Partial<Settings>);
    expect(S().settings.browseLimit).toBe(10);
    expect(h.store.write).toHaveBeenCalledWith("settings", { ...DEFAULT_SETTINGS, browseLimit: 10 });
    const t = [{ name: "d", body: "", mqmd: emptyMqmd(), properties: [] }];
    await S().saveTemplates(t);
    expect(S().templates).toBe(t);
    expect(h.store.write).toHaveBeenCalledWith("templates", { templates: t });
  });
});

describe("saveConnection", () => {
  it("stores secrets in the keyring when asked to", async () => {
    await S().saveConnection(conn(), { password: "p", keystorePassword: "k", truststorePassword: "t" });
    expect(h.secrets.set.mock.calls).toEqual([["c1", "p"], ["c1:keystore", "k"], ["c1:truststore", "t"]]);
    expect(S()).toMatchObject({ focusConn: "c1" });
    expect(persisted()).toEqual([conn()]);
    await S().saveConnection(conn({ name: "Renamed" }), {});
    expect(S().connections).toEqual([conn({ name: "Renamed" })]);
    expect(h.secrets.set).toHaveBeenCalledTimes(3);
  });

  it("keeps unsaved secrets for the session only", async () => {
    await S().saveConnection(conn({ savePassword: false }), { password: "session" });
    expect(h.secrets.delete).toHaveBeenCalledTimes(3);
    await S().connect("c1");
    expect(h.api.connect).toHaveBeenCalledWith(conn({ savePassword: false }), { password: "session" });

    await S().saveConnection(conn({ savePassword: false }), {});
    h.secrets.delete.mockRejectedValue(new Error("locked"));
    await S().saveConnection(conn({ savePassword: false }), {});
  });

  it("reconnects a live connection after an edit", async () => {
    useApp.setState({ connections: [conn()], status: { c1: { state: "connected", attempt: 0 } } });
    await S().saveConnection(conn({ port: 1415 }), {});
    expect(h.api.disconnect).toHaveBeenCalledWith("c1");
    expect(h.api.connect).toHaveBeenCalledWith(conn({ port: 1415 }), undefined);
  });
});

describe("deleteConnection", () => {
  it("removes the connection, its secrets and its tabs", async () => {
    h.api.disconnect.mockRejectedValue(new Error("not connected"));
    useApp.setState({
      connections: [conn(), conn({ id: "c2" })], activeTab: "a",
      tabs: [{ id: "a", kind: "queues", connId: "c1" }, { id: "b", kind: "queues", connId: "c2" }],
    });
    await S().deleteConnection("c1");
    expect(S().connections.map((c) => c.id)).toEqual(["c2"]);
    expect(S()).toMatchObject({ activeTab: "b", focusConn: "c2" });
    expect(S().tabs.map((t) => t.id)).toEqual(["b"]);
    expect(h.secrets.delete).toHaveBeenCalledWith("c1:truststore");

    useApp.setState({ tabs: [{ id: "b", kind: "queues", connId: "c2" }, { id: "x", kind: "queues", connId: "c3" }], activeTab: "x" });
    await S().deleteConnection("c2");
    expect(S()).toMatchObject({ activeTab: "x", focusConn: null });
    await S().deleteConnection("c3");
    expect(S().activeTab).toBeNull();
  });
});

describe("importConnections", () => {
  it("adds new connections and replaces ones with the same id or name", async () => {
    useApp.setState({ connections: [conn(), conn({ id: "c2", name: "Two" })] });
    const added = await S().importConnections([
      conn({ host: "new-host" }),
      { ...conn({ id: "other", name: "Two", port: 2000 }), tls: undefined } as unknown as Connection,
      conn({ id: "c3", name: "Three", tls: { enabled: true } as Connection["tls"] }),
    ]);
    expect(added).toBe(1);
    const [a, b, c] = S().connections;
    expect(a.host).toBe("new-host");
    expect(b).toMatchObject({ id: "c2", port: 2000 });
    expect(b.tls.cipher).toBe("*TLS13ORHIGHER");
    expect(c.tls).toMatchObject({ enabled: true, cipher: "*TLS13ORHIGHER" });
    expect(persisted()).toHaveLength(3);
  });
});

describe("connect / disconnect / queues", () => {
  beforeEach(() => useApp.setState({ connections: [conn({ defaultQueue: "Q" })] }));

  it("connects and loads queues", async () => {
    h.api.listQueues.mockResolvedValue({ source: "probe", queues: [queue("Q"), queue("NOPE", { error: "MQRC_UNKNOWN_OBJECT_NAME" })] });
    expect(await S().connect("c1")).toBe(true);
    await flush();
    const st = S().status.c1;
    expect(st).toMatchObject({ state: "connected", info, attempt: 0, queuesSource: "probe", queuesLoading: false });
    expect(st.queues!.map((q) => q.name)).toEqual(["Q"]);
    expect(st.queuesHidden!.map((q) => q.name)).toEqual(["NOPE"]);
    expect(h.api.listQueues).toHaveBeenCalledWith("c1", ["Q"]);
  });

  it("records a failed connect and counts attempts", async () => {
    expect(await S().connect("missing")).toBe(false);
    h.api.connect.mockRejectedValue(new MqCallError(mqError(2059, "MQRC_Q_MGR_NOT_AVAILABLE")));
    await S().connect("c1");
    await S().connect("c1");
    expect(S().status.c1).toMatchObject({ state: "error", attempt: 2, error: { code: 2059 } });
  });

  it("disconnects even when the sidecar call fails", async () => {
    h.api.disconnect.mockRejectedValue(new Error("x"));
    useApp.setState({ status: { c1: { state: "connected", attempt: 0, queues: [queue("Q")] } } });
    await S().disconnect("c1");
    expect(S().status.c1).toMatchObject({ state: "disconnected", queues: undefined });
  });

  it("keeps the queue list error", async () => {
    h.api.listQueues.mockRejectedValue(new MqCallError(mqError(2035, "MQRC_NOT_AUTHORIZED")));
    await S().loadQueues("unknown-conn");
    expect(h.api.listQueues).toHaveBeenCalledWith("unknown-conn", []);
    expect(S().status["unknown-conn"]).toMatchObject({ queuesError: { code: 2035 }, queuesLoading: false });
  });

  it("addQueue checks a queue by name and remembers it", async () => {
    expect(await S().addQueue("c1", "  ")).toBeNull();

    h.api.listQueues.mockRejectedValueOnce(new MqCallError(mqError(2059, "MQRC_Q_MGR_NOT_AVAILABLE")));
    expect(await S().addQueue("c1", "A")).toMatchObject({ code: 2059 });

    h.api.listQueues.mockResolvedValueOnce({ source: "probe", queues: [] });
    expect(await S().addQueue("c1", "A")).toMatchObject({ code: 2085, message: "A does not exist on this queue manager." });

    h.api.listQueues.mockResolvedValueOnce({ source: "probe", queues: [queue("A", { error: "MQRC_NOT_AUTHORIZED" })] });
    expect(await S().addQueue("c1", "A")).toMatchObject({ code: 2035, message: "You have no access to A." });

    useApp.setState({ status: { c1: { state: "connected", attempt: 0, queues: [queue("A", { depth: 1 })], queuesHidden: [queue("A")] } } });
    h.api.listQueues.mockResolvedValueOnce({ source: "probe", queues: [queue("A", { depth: 5 })] });
    expect(await S().addQueue("c1", " A ")).toBeNull();
    expect(S().connections[0].queues).toEqual(["A"]);
    expect(S().status.c1.queues).toEqual([queue("A", { depth: 5 })]);
    expect(S().status.c1.queuesHidden).toEqual([]);

    h.store.write.mockClear();
    h.api.listQueues.mockResolvedValueOnce({ source: "probe", queues: [queue("Q")] });
    useApp.setState({ status: {} });
    expect(await S().addQueue("c1", "Q")).toBeNull(); // already the default queue
    expect(h.store.write).not.toHaveBeenCalled();
    expect(S().status.c1.queues).toEqual([queue("Q")]);
  });

  it("removeQueue forgets it, including as the default queue", async () => {
    useApp.setState({
      connections: [conn({ defaultQueue: "Q", queues: ["Q", "R"] }), conn({ id: "c2", defaultQueue: "R" })],
      status: { c1: { state: "connected", attempt: 0, queues: [queue("Q"), queue("R")], queuesHidden: [queue("Q")] } },
    });
    await S().removeQueue("c1", "Q");
    expect(S().connections[0]).toMatchObject({ queues: ["R"], defaultQueue: undefined });
    expect(S().status.c1.queues!.map((q) => q.name)).toEqual(["R"]);
    expect(S().status.c1.queuesHidden).toEqual([]);
    await S().removeQueue("c1", "R");
    expect(S().connections[0].queues).toEqual([]);
    await S().removeQueue("c2", "X");
    expect(S().connections[1]).toMatchObject({ queues: [], defaultQueue: "R" });
  });
});

describe("tabs", () => {
  beforeEach(() => useApp.setState({ connections: [conn()] }));

  it("openQueues opens one tab per connection and connects", async () => {
    S().openQueues("c1");
    const id = S().activeTab;
    expect(S().tabs).toEqual([{ id, kind: "queues", connId: "c1" }]);
    expect(h.api.connect).toHaveBeenCalledTimes(1);
    await flush();
    useApp.setState({ activeTab: null });
    S().openQueues("c1");
    expect(S()).toMatchObject({ activeTab: id, focusConn: "c1" });
    expect(S().tabs).toHaveLength(1);
    expect(h.api.connect).toHaveBeenCalledTimes(1);
  });

  it("openBrowse opens a browse tab and loads it", async () => {
    h.api.browse.mockResolvedValue(browseResult([message("A"), message("B")]));
    S().openBrowse("c1", "Q");
    const id = S().activeTab!;
    expect(S().browse[id]).toMatchObject({ loading: true, auto: true });
    await vi.waitFor(() => expect(S().browse[id].loading).toBe(false));
    expect(S().browse[id]).toMatchObject({ selected: "A", depth: 2 });

    useApp.setState({ activeTab: null });
    S().openBrowse("c1", "Q");
    expect(S().activeTab).toBe(id);
  });

  it("openBrowse shows the connect error in the tab", async () => {
    h.api.connect.mockRejectedValue(new MqCallError(mqError(2035, "MQRC_NOT_AUTHORIZED")));
    useApp.setState({ settings: { ...DEFAULT_SETTINGS, refreshInterval: 0 } });
    S().openBrowse("c1", "Q");
    const id = S().activeTab!;
    expect(S().browse[id].auto).toBe(false);
    await vi.waitFor(() => expect(S().browse[id].loading).toBe(false));
    expect(S().browse[id].error).toMatchObject({ code: 2035 });
  });

  it("activate and closeTab", () => {
    useApp.setState({
      focusConn: "c9", activeTab: "b",
      tabs: [{ id: "a", kind: "queues", connId: "c1" }, { id: "b", kind: "queues", connId: "c2" }, { id: "c", kind: "queues", connId: "c3" }],
      browse: { b: {} as BrowseState },
    });
    S().activate("a");
    expect(S()).toMatchObject({ activeTab: "a", focusConn: "c1" });
    S().activate("ghost");
    expect(S()).toMatchObject({ activeTab: "ghost", focusConn: "c1" });

    useApp.setState({ activeTab: "b" });
    S().closeTab("b");
    expect(S()).toMatchObject({ activeTab: "c", browse: {} });
    S().closeTab("a");
    expect(S().activeTab).toBe("c");
    S().closeTab("c");
    expect(S().activeTab).toBeNull();
  });
});

describe("refreshBrowse", () => {
  const tab = { id: "t", kind: "browse" as const, connId: "c1", queue: "Q" };
  const b = (p: Partial<BrowseState> = {}): BrowseState => ({
    loading: false, loadingMore: false, depth: 0, maxDepth: 0, messages: [], more: false, selected: null, checked: {}, fresh: {},
    search: "", regex: false, filters: { format: "", kind: "", correlOnly: false }, auto: true, pollErrors: 0,
    detailTab: "payload", pview: null, detailClosed: false, ...p,
  });

  beforeEach(() => useApp.setState({
    connections: [conn()], tabs: [tab], browse: { t: b() },
    status: { c1: { state: "connected", attempt: 0, queuesSource: "pcf", queues: [queue("Q", { depth: 9 })] } },
  }));

  it("ignores unknown tabs", async () => {
    await S().refreshBrowse("ghost");
    useApp.setState({ tabs: [{ id: "q", kind: "queues", connId: "c1" }], browse: { q: b() } });
    await S().refreshBrowse("q");
    expect(h.api.browse).not.toHaveBeenCalled();
  });

  it("reset loads the first page, selects the first message and syncs the depth", async () => {
    h.api.browse.mockResolvedValue(browseResult([message("A"), message("B")], { depth: 2, more: true }));
    await S().refreshBrowse("t");
    expect(h.api.browse).toHaveBeenCalledWith("c1", "Q", 0, 50);
    expect(S().browse.t).toMatchObject({ selected: "A", more: true, depth: 2, error: undefined, pollErrors: 0 });
    expect(S().status.c1.queues![0].depth).toBe(2);

    h.api.browse.mockResolvedValue(browseResult([], { depth: 0 }));
    await S().refreshBrowse("t");
    expect(S().browse.t.selected).toBeNull();
  });

  it("more appends the next page", async () => {
    useApp.setState({ browse: { t: b({ messages: [message("A")], selected: "A", checked: { A: true, GONE: true } }) } });
    h.api.browse.mockResolvedValue(browseResult([message("B")], { depth: 2 }));
    await S().refreshBrowse("t", "more");
    expect(h.api.browse).toHaveBeenCalledWith("c1", "Q", 1, 50);
    expect(S().browse.t.messages.map((m) => m.msgId)).toEqual(["A", "B"]);
    expect(S().browse.t).toMatchObject({ selected: "A", checked: { A: true }, loadingMore: false });
  });

  it("poll marks new messages as fresh and keeps the page size", async () => {
    const many = Array.from({ length: 60 }, (_, i) => message(`M${i}`));
    useApp.setState({ browse: { t: b({ messages: many, selected: "GONE" }) } });
    h.api.browse.mockResolvedValue(browseResult([message("M0"), message("NEW")]));
    await S().refreshBrowse("t", "poll");
    expect(h.api.browse).toHaveBeenCalledWith("c1", "Q", 0, 60);
    expect(S().browse.t).toMatchObject({ fresh: { NEW: true }, selected: null });
  });

  it("shows errors on reset and more", async () => {
    h.api.browse.mockRejectedValue(new MqCallError(mqError(2016, "MQRC_GET_INHIBITED")));
    await S().refreshBrowse("t");
    expect(S().browse.t).toMatchObject({ loading: false, error: { code: 2016 } });
    await S().refreshBrowse("t", "more");
    expect(S().browse.t.loadingMore).toBe(false);
  });

  it("stops auto-refresh after three failed polls", async () => {
    h.api.browse.mockRejectedValue(new MqCallError(mqError(2009, "MQRC_CONNECTION_BROKEN")));
    await S().refreshBrowse("t", "poll");
    await S().refreshBrowse("t", "poll");
    expect(S().browse.t).toMatchObject({ pollErrors: 2, auto: true });
    await S().refreshBrowse("t", "poll");
    expect(S().browse.t).toMatchObject({ pollErrors: 0, auto: false });
    expect(S().toast).toMatchObject({ title: "Auto-refresh stopped", sub: "Q · MQRC_CONNECTION_BROKEN after 3 failed refreshes" });
  });

  it("reconnects first, and uses the connect error when that fails", async () => {
    useApp.setState({ status: {} });
    h.api.connect.mockRejectedValue(new MqCallError(mqError(2538, "MQRC_HOST_NOT_AVAILABLE")));
    await S().refreshBrowse("t");
    expect(S().browse.t.error).toMatchObject({ code: 2538, name: "MQRC_HOST_NOT_AVAILABLE" });

    const failing = vi.fn().mockResolvedValue(false);
    useApp.setState({ connect: failing, status: {} });
    await S().refreshBrowse("t");
    expect(S().browse.t.error).toMatchObject({ name: "UNEXPECTED", message: "not connected" });
  });

  it("remembers a queue opened by name when there is no PCF list", async () => {
    useApp.setState({ status: { c1: { state: "connected", attempt: 0, queuesSource: "probe", queues: [] } } });
    h.api.browse.mockResolvedValue(browseResult([]));
    await S().refreshBrowse("t");
    expect(S().connections[0].queues).toEqual(["Q"]);
    expect(h.api.listQueues).toHaveBeenCalledWith("c1", ["Q"]);

    useApp.setState({ status: { c1: { state: "connected", attempt: 0, queuesSource: "probe" } } });
    await S().refreshBrowse("t");
    expect(S().connections[0].queues).toEqual(["Q"]);
  });

  it("patchBrowse ignores missing tabs and replaceMessage keeps the sequence number", () => {
    S().patchBrowse("ghost", { loading: true });
    expect(S().browse.ghost).toBeUndefined();
    useApp.setState({ browse: { t: b({ messages: [message("A", { seq: 7 }), message("B")] }) } });
    S().replaceMessage("t", message("A", { seq: 1, text: "full" }));
    expect(S().browse.t.messages[0]).toMatchObject({ seq: 7, text: "full" });
    expect(S().browse.t.messages[1].msgId).toBe("B");
  });
});

describe("overlay and toast", () => {
  it("sets the overlay", () => {
    S().setOverlay({ kind: "settings" });
    expect(S().overlay).toEqual({ kind: "settings" });
  });

  it("auto-hides a toast unless a newer one replaced it", () => {
    vi.useFakeTimers();
    S().showToast({ tone: "ok", title: "one" });
    vi.advanceTimersByTime(5999);
    expect(S().toast?.title).toBe("one");
    vi.advanceTimersByTime(1);
    expect(S().toast).toBeNull();

    S().showToast({ tone: "ok", title: "two" });
    useApp.setState({ toast: { id: -1, tone: "ok", title: "manual" } });
    vi.advanceTimersByTime(6000);
    expect(S().toast?.title).toBe("manual");
    S().closeToast();
    expect(S().toast).toBeNull();
  });
});
