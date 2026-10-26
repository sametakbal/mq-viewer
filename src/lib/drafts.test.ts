import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyMqmd, useApp } from "../state";
import { conn, mqError } from "../test/fixtures";
import { draftConnId, draftTargets, putAndReport, putToTargets, sendDraft, uniqueTargets } from "./drafts";
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

describe("putToTargets", () => {
  const c2 = conn({ id: "c2", name: "Remote", qmgr: "QM2" });
  beforeEach(() => {
    useApp.setState({ connections: [conn(), c2], status: { c1: { state: "connected", attempt: 0 }, c2: { state: "connected", attempt: 0 } } });
  });

  it("drops blank and repeated targets", () => {
    expect(uniqueTargets([{ connId: "c1", queue: " Q " }, { connId: "c1", queue: "q" }, { connId: "c2", queue: "Q" }, { connId: "c1", queue: "" }]))
      .toEqual([{ connId: "c1", queue: "Q" }, { connId: "c2", queue: "Q" }]);
  });

  it("uses the single-queue report for one target", async () => {
    expect(await putToTargets([{ connId: "c1", queue: "Q" }, { connId: "c1", queue: "Q" }], { body: "x" }, mqmd, [], 1)).toEqual([]);
    expect(h.put).toHaveBeenCalledTimes(1);
    expect(toast().title).toBe("Message sent to Q");
  });

  it("puts identical rendered messages to every queue and reports once", async () => {
    h.put.mockImplementation(async (_c: string, q: string) => ({ count: 2, msgIds: [`${q}-1`, `${q}-2`], elapsedMs: 1 }));
    const failed = await putToTargets([{ connId: "c1", queue: "A" }, { connId: "c1", queue: "B" }, { connId: "c2", queue: "C" }],
      { body: "n={{index()}}" }, mqmd, [], 2);
    expect(failed).toEqual([]);
    // Connections run in parallel, so only the order within one connection is fixed.
    expect(h.put.mock.calls.map((c) => [c[0], c[1], c[2]]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      ["c1", "A", { bodies: ["n=1", "n=2"] }], ["c1", "B", { bodies: ["n=1", "n=2"] }], ["c2", "C", { bodies: ["n=1", "n=2"] }],
    ]);
    expect(toast()).toMatchObject({ tone: "ok", title: "2 messages sent to 3 queues" });
    expect(toast().sub).toMatch(/^Local › A · Local › B · Remote › C · \d+ ms$/);
    expect(fns.loadQueues).toHaveBeenCalledWith("c2");
    toast().actions![0].run();
    expect(h.copyText).toHaveBeenCalledWith(["A-1", "A-2", "B-1", "B-2", "C-1", "C-2"].join("\n"));
  });

  it("returns and reports only the queues that failed", async () => {
    h.put.mockImplementation(async (_c: string, q: string) => {
      if (q === "B") throw new MqCallError(mqError(2085, "MQRC_UNKNOWN_OBJECT_NAME"));
      return { count: 1, msgIds: ["M"], elapsedMs: 1 };
    });
    const failed = await putToTargets([{ connId: "c1", queue: "A" }, { connId: "c1", queue: "B" }], { body: "x" }, mqmd, [], 1, "Daily");
    expect(failed).toEqual([{ connId: "c1", queue: "B" }]);
    expect(toast()).toMatchObject({ tone: "err", title: "Sent to 1 of 2 queues", sub: "B: MQRC 2085 MQRC_UNKNOWN_OBJECT_NAME" });
  });

  it("connects a target's queue manager first and fails its queues when that does not work", async () => {
    useApp.setState({ status: { c1: { state: "connected", attempt: 0 }, c2: { state: "error", attempt: 1, error: mqError(2059, "MQRC_Q_MGR_NOT_AVAILABLE") } } });
    fns.connect.mockResolvedValue(false);
    const failed = await putToTargets([{ connId: "c1", queue: "A" }, { connId: "c2", queue: "C" }], { body: "x" }, mqmd, [], 1);
    expect(fns.connect).toHaveBeenCalledWith("c2");
    expect(failed).toEqual([{ connId: "c2", queue: "C" }]);
    expect(toast()).toMatchObject({ tone: "err", title: "Sent to 1 of 2 queues", sub: "Remote › C: MQRC 2059 MQRC_Q_MGR_NOT_AVAILABLE" });
  });

  it("puts nothing on a template error", async () => {
    const targets = [{ connId: "c1", queue: "A" }, { connId: "c2", queue: "C" }];
    expect(await putToTargets(targets, { body: "{{nope}}" }, mqmd, [], 1)).toEqual(targets);
    expect(h.put).not.toHaveBeenCalled();
    expect(toast()).toMatchObject({ tone: "err", title: "Template error" });
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

  it("sends to the extra targets too, skipping ones whose connection is gone", async () => {
    const multi = { ...draft, targets: [{ connId: "c1", queue: "Q2" }, { connId: "deleted", queue: "Q3" }] };
    expect(draftTargets(multi)).toEqual([{ connId: "c1", queue: "Q" }, { connId: "c1", queue: "Q2" }]);
    expect(await sendDraft(multi)).toBe(true);
    expect(h.put.mock.calls.map((c) => c[1])).toEqual(["Q", "Q2"]);
    expect(toast().title).toBe("Daily → 2 queues");
  });
});
