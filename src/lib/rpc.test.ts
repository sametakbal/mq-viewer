import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "./types";

const conn: Connection = {
  id: "c1", name: "Local", folder: "DEV", env: "DEV", color: 0, host: "localhost", port: 1414, qmgr: "QM1",
  channel: "DEV.APP.SVRCONN", user: "app", savePassword: true,
  tls: { enabled: true, cipher: "*TLS13", keystore: "/k.p12", truststore: "/t.jks", certLabel: "", peerName: "" },
};
const wire = (password: string | null, ks: string | null = null, ts: string | null = null) => ({
  id: "c1", host: "localhost", port: 1414, channel: "DEV.APP.SVRCONN", qmgr: "QM1", user: "app", password,
  tls: { ...conn.tls, keystorePassword: ks, truststorePassword: ts },
});

type Rpc = typeof import("./rpc");

describe("in the browser (mock backend)", () => {
  const mockBackend = vi.fn();
  let rpc: Rpc;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("./mock", () => ({ mockBackend }));
    mockBackend.mockReset().mockResolvedValue("ok");
    rpc = await import("./rpc");
  });

  it("is not in Tauri", () => {
    expect(rpc.inTauri).toBe(false);
  });

  it("sends every MQ call through mq_call with the wire connection", async () => {
    const { api } = rpc;
    await api.test(conn);
    expect(mockBackend).toHaveBeenLastCalledWith("mq_call", { method: "test", params: { conn: wire(null) } });
    await api.connect(conn, { password: "p", keystorePassword: "k", truststorePassword: "t" });
    expect(mockBackend).toHaveBeenLastCalledWith("mq_call", { method: "connect", params: { conn: wire("p", "k", "t") } });

    const calls: [() => Promise<unknown>, string, Record<string, unknown>][] = [
      [() => api.disconnect("c1"), "disconnect", { connId: "c1" }],
      [() => api.listQueues("c1", ["Q"]), "listQueues", { connId: "c1", known: ["Q"] }],
      [() => api.browse("c1", "Q", 10, 50), "browse", { connId: "c1", queue: "Q", offset: 10, limit: 50 }],
      [() => api.detail("c1", "Q", "AB"), "detail", { connId: "c1", queue: "Q", msgId: "AB" }],
      [() => api.deleteMessages("c1", "Q", ["AB"]), "delete", { connId: "c1", queue: "Q", msgIds: ["AB"] }],
      [() => api.purge("c1", "Q"), "purge", { connId: "c1", queue: "Q" }],
    ];
    for (const [call, method, params] of calls) {
      await call();
      expect(mockBackend).toHaveBeenLastCalledWith("mq_call", { method, params });
    }

    const mqmd = { msgId: "", correlId: "", format: "MQSTR", priority: null, persistence: "Q" as const, expiry: null, replyToQ: "", replyToQmgr: "", ccsid: 1208 };
    await api.put("c1", "Q", { bodies: ["a", "b"] }, mqmd, [], 2);
    expect(mockBackend).toHaveBeenLastCalledWith("mq_call", {
      method: "put", params: { connId: "c1", queue: "Q", bodies: ["a", "b"], mqmd, properties: [], count: 2 },
    });
  });

  it("wraps MQ errors and unexpected failures in MqCallError", async () => {
    mockBackend.mockRejectedValueOnce({ code: 2035, name: "MQRC_NOT_AUTHORIZED", cc: 2, message: "no" });
    const e1 = await rpc.api.purge("c1", "Q").catch((e) => e);
    expect(e1).toBeInstanceOf(rpc.MqCallError);
    expect(e1.message).toBe("MQRC_NOT_AUTHORIZED (2035): no");
    expect(rpc.asMqError(e1)).toMatchObject({ code: 2035 });

    mockBackend.mockRejectedValueOnce("boom");
    const e2 = await rpc.api.purge("c1", "Q").catch((e) => e);
    expect(e2.err).toEqual({ code: 0, name: "UNEXPECTED", cc: 2, message: "boom" });
    expect(e2.message).toBe("UNEXPECTED: boom");
  });

  it("turns anything into an MqError", () => {
    expect(rpc.asMqError(new Error("bad"))).toEqual({ code: 0, name: "UNEXPECTED", cc: 2, message: "bad" });
    expect(rpc.asMqError(42)).toMatchObject({ message: "42" });
  });

  it("routes store, secrets and files commands", async () => {
    const cases: [() => Promise<unknown>, string, Record<string, unknown>][] = [
      [() => rpc.store.read("settings"), "doc_read", { name: "settings" }],
      [() => rpc.store.write("templates", { a: 1 }), "doc_write", { name: "templates", value: { a: 1 } }],
      [() => rpc.secrets.get("k"), "secret_get", { key: "k" }],
      [() => rpc.secrets.set("k", "v"), "secret_set", { key: "k", value: "v" }],
      [() => rpc.secrets.delete("k"), "secret_delete", { key: "k" }],
      [() => rpc.files.readText("/a"), "file_read_text", { path: "/a" }],
      [() => rpc.files.readBase64("/a"), "file_read_base64", { path: "/a" }],
      [() => rpc.files.writeText("/a", "x"), "file_write_text", { path: "/a", contents: "x" }],
      [() => rpc.files.writeBase64("/a", "eA=="), "file_write_base64", { path: "/a", data: "eA==" }],
    ];
    for (const [call, cmd, args] of cases) {
      await call();
      expect(mockBackend).toHaveBeenLastCalledWith(cmd, args);
    }
    await rpc.store.legacyConnections();
    expect(mockBackend).toHaveBeenLastCalledWith("legacy_connections", {});
    await rpc.store.dataDir();
    expect(mockBackend).toHaveBeenLastCalledWith("data_dir", {});
  });

  it("has no native dialogs and only sets the document title", async () => {
    expect(await rpc.pickOpen([])).toBeNull();
    expect(await rpc.pickSave("a.json", [])).toBeNull();
    await rpc.setWindowTitle("MQ Viewer");
    expect(document.title).toBe("MQ Viewer");
  });

  it("derives keyring keys", () => {
    expect(rpc.secretKey.password("c1")).toBe("c1");
    expect(rpc.secretKey.keystore("c1")).toBe("c1:keystore");
    expect(rpc.secretKey.truststore("c1")).toBe("c1:truststore");
  });
});

describe("inside Tauri", () => {
  const invoke = vi.fn();
  const open = vi.fn();
  const save = vi.fn();
  const setTitle = vi.fn();
  let rpc: Rpc;

  beforeEach(async () => {
    vi.resetModules();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open, save }));
    vi.doMock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle }) }));
    invoke.mockReset().mockResolvedValue({ ok: true });
    rpc = await import("./rpc");
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("invokes Tauri commands", async () => {
    expect(rpc.inTauri).toBe(true);
    expect(await rpc.api.disconnect("c1")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("mq_call", { method: "disconnect", params: { connId: "c1" } });
  });

  it("opens native dialogs", async () => {
    open.mockResolvedValueOnce("/tmp/a.json").mockResolvedValueOnce(["/a", "/b"]);
    expect(await rpc.pickOpen([{ name: "JSON", extensions: ["json"] }])).toBe("/tmp/a.json");
    expect(await rpc.pickOpen([])).toBeNull();
    expect(open).toHaveBeenCalledWith({ multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });

    save.mockResolvedValueOnce("/tmp/out.json");
    expect(await rpc.pickSave("out.json", [])).toBe("/tmp/out.json");
    expect(save).toHaveBeenCalledWith({ defaultPath: "out.json", filters: [] });
  });

  it("sets the native window title", async () => {
    await rpc.setWindowTitle("QM1");
    expect(setTitle).toHaveBeenCalledWith("QM1");
  });
});
