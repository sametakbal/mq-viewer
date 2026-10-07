import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyMqmd, useApp } from "../state";
import { conn, mqError } from "../test/fixtures";
import { draftConnId, putAndReport, sendDraft } from "./drafts";
import { MqCallError } from "./rpc";
import type { Template } from "./types";

const h = vi.hoisted(() => ({ put: vi.fn(), copyText: vi.fn() }));
vi.mock("./rpc", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./rpc")>();
  return { ...orig, api: { ...orig.api, put: h.put } };
});
vi.mock("./format", async (importOriginal) => ({ ...(await importOriginal<typeof import("./format")>()), copyText: h.copyText }));

const mqmd = emptyMqmd();
const fns = { openBrowse: vi.fn(), refreshBrowse: vi.fn(), loadQueues: vi.fn(), connect: vi.fn(), setOverlay: vi.fn() };
const toast = () => useApp.getState().toast!;

beforeEach(() => {
  h.put.mockReset().mockResolvedValue({ count: 1, msgIds: ["414D51AA"], elapsedMs: 3 });
  for (const f of Object.values(fns)) f.mockReset();
  useApp.setState({
    ...fns, toast: null, connections: [conn()], focusConn: null, activeTab: null,
    status: { c1: { state: "connected", attempt: 0 } },
    tabs: [{ id: "t1", kind: "browse", connId: "c1", queue: "Q" }, { id: "t2", kind: "browse", connId: "c1", queue: "OTHER" }],
  });
});

describe("putAndReport", () => {
  it("puts, reports and refreshes views of that queue", async () => {
    const props = [{ name: "a", type: "String", value: "1" }, { name: " ", type: "String", value: "" }];
    expect(await putAndReport("c1", "Q", { body: "plain" }, mqmd, props, 1)).toBe(true);
    expect(h.put).toHaveBeenCalledWith("c1", "Q", { body: "plain" }, mqmd, [props[0]], 1);
    expect(toast()).toMatchObject({ tone: "ok", title: "Message sent to Q", sub: "MsgId 414D51AA · 1 of 1 · 3 ms" });
    expect(fns.refreshBrowse).toHaveBeenCalledTimes(1);
    expect(fns.refreshBrowse).toHaveBeenCalledWith("t1", "poll");
    expect(fns.loadQueues).toHaveBeenCalledWith("c1");

    toast().actions![0].run();
    expect(fns.openBrowse).toHaveBeenCalledWith("c1", "Q");
    toast().actions![1].run();
    expect(h.copyText).toHaveBeenCalledWith("414D51AA");
  });

  it("renders templated bodies, one per message", async () => {
    h.put.mockResolvedValue({ count: 3, msgIds: ["A", "B", "C"], elapsedMs: 9 });
    await putAndReport("c1", "Q", { body: "n={{index()}}" }, mqmd, [], 3, "Draft X");
    expect(h.put.mock.calls[0][2]).toEqual({ bodies: ["n=1", "n=2", "n=3"] });
    expect(toast()).toMatchObject({ title: "Draft X → Q", sub: "3 messages · MsgId C · 3 of 3 · 9 ms" });
  });

  it("sends binary bodies unchanged", async () => {
    await putAndReport("c1", "Q", { bodyBase64: "e3t9fQ==" }, mqmd, [], 1);
    expect(h.put.mock.calls[0][2]).toEqual({ bodyBase64: "e3t9fQ==" });
  });

  it("stops on a template error", async () => {
    expect(await putAndReport("c1", "Q", { body: "{{nope}}" }, mqmd, [], 1)).toBe(false);
    expect(h.put).not.toHaveBeenCalled();
    expect(toast()).toMatchObject({ tone: "err", title: "Template error" });
  });

  it("reports MQ failures", async () => {
    h.put.mockRejectedValue(new MqCallError(mqError(2053, "MQRC_Q_FULL")));
    expect(await putAndReport("c1", "Q", { body: "x" }, mqmd, [], 1)).toBe(false);
    expect(toast()).toMatchObject({ tone: "err", title: "Put to Q failed", sub: "MQRC 2053 MQRC_Q_FULL" });

    h.put.mockRejectedValue(new Error("gone"));
    await putAndReport("c1", "Q", { body: "x" }, mqmd, [], 1);
    expect(toast().sub).toBe("UNEXPECTED");
  });
});

describe("draftConnId", () => {
  const t = (p: Partial<Template> = {}): Template => ({ name: "d", body: "x", mqmd, properties: [], ...p });

  it("prefers the draft's own connection, then the active tab, then the focused one", () => {
    expect(draftConnId(t({ connId: "c1" }))).toBe("c1");
    useApp.setState({ activeTab: "t2", focusConn: "zz" });
    expect(draftConnId(t({ connId: "deleted" }))).toBe("c1");
    useApp.setState({ activeTab: null });
    expect(draftConnId(t())).toBe("zz");
  });
});

describe("sendDraft", () => {
  const draft: Template = { name: "Daily", body: "x", mqmd: { ccsid: 819 } as Template["mqmd"], properties: [], queue: "Q", connId: "c1", count: 2 };

  it("opens the connection dialog when there is no connection", async () => {
    useApp.setState({ connections: [] });
    expect(await sendDraft({ ...draft, connId: undefined })).toBe(false);
    expect(fns.setOverlay).toHaveBeenCalledWith({ kind: "connection" });
  });

  it("opens the Put dialog when the draft has no queue", async () => {
    expect(await sendDraft({ ...draft, queue: undefined })).toBe(false);
    expect(fns.setOverlay).toHaveBeenCalledWith({ kind: "put", connId: "c1", queue: "", draftName: "Daily" });
  });

  it("connects first and reports a failed connection", async () => {
    useApp.setState({ status: { c1: { state: "error", attempt: 1, error: mqError(2059, "MQRC_Q_MGR_NOT_AVAILABLE") } } });
    fns.connect.mockResolvedValue(false);
    expect(await sendDraft(draft)).toBe(false);
    expect(toast()).toMatchObject({ title: 'Could not connect for "Daily"', sub: "MQRC 2059 MQRC_Q_MGR_NOT_AVAILABLE" });

    useApp.setState({ status: {} });
    await sendDraft(draft);
    expect(toast().sub).toBeUndefined();

    useApp.setState({ status: { c1: { state: "error", attempt: 1, error: mqError(0, "SIDECAR_EXITED") } } });
    await sendDraft(draft);
    expect(toast().sub).toBe("SIDECAR_EXITED");
  });

  it("sends with the draft's settings once connected", async () => {
    useApp.setState({ status: {} });
    fns.connect.mockResolvedValue(true);
    expect(await sendDraft(draft)).toBe(true);
    expect(h.put).toHaveBeenCalledWith("c1", "Q", { body: "x" }, { ...mqmd, ccsid: 819 }, [], 2);
    expect(toast().title).toBe("Daily → Q");

    await sendDraft({ ...draft, count: undefined });
    expect(h.put.mock.calls[1][5]).toBe(1);
  });
});
