import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../state";
import { conn, message } from "../test/fixtures";
import {
  exportConnectionsToFile, exportMessages, importConnectionsFromFile, pickKeystore, pickPayloadFile, savePayload,
} from "./transfer";

const h = vi.hoisted(() => ({
  inTauri: true,
  pickOpen: vi.fn(),
  pickSave: vi.fn(),
  files: { readText: vi.fn(), readBase64: vi.fn(), writeText: vi.fn(), writeBase64: vi.fn() },
}));

vi.mock("./rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rpc")>()),
  get inTauri() {
    return h.inTauri;
  },
  pickOpen: h.pickOpen,
  pickSave: h.pickSave,
  files: h.files,
}));

const toast = () => useApp.getState().toast;
const written = () => JSON.parse(h.files.writeText.mock.calls[0][1]);

beforeEach(() => {
  h.inTauri = true;
  for (const f of [h.pickOpen, h.pickSave, ...Object.values(h.files)]) f.mockReset();
  useApp.setState({ toast: null, connections: [conn()] });
});

describe("outside Tauri", () => {
  it("every action tells the user it needs the desktop app", async () => {
    h.inTauri = false;
    for (const run of [
      () => importConnectionsFromFile(), () => exportConnectionsToFile(), () => exportMessages("Q", [message("A")]),
      () => savePayload(message("A")), () => pickPayloadFile(), () => pickKeystore(),
    ]) {
      useApp.setState({ toast: null });
      expect(await run()).toBeFalsy();
      expect(toast()?.title).toBe("Not available in the browser preview");
    }
    expect(h.pickOpen).not.toHaveBeenCalled();
  });
});

describe("importConnectionsFromFile", () => {
  it("does nothing when the dialog is cancelled", async () => {
    h.pickOpen.mockResolvedValue(null);
    await importConnectionsFromFile();
    expect(h.files.readText).not.toHaveBeenCalled();
  });

  it("imports a { connections } file and an array", async () => {
    const importConnections = vi.fn().mockResolvedValue(1);
    useApp.setState({ importConnections });
    h.pickOpen.mockResolvedValue("/c.json");

    h.files.readText.mockResolvedValue(JSON.stringify({ connections: [conn(), conn({ id: "c2" })] }));
    await importConnectionsFromFile();
    expect(importConnections).toHaveBeenCalledWith([conn(), conn({ id: "c2" })]);
    expect(toast()).toMatchObject({ tone: "ok", title: "Imported 2 connections", sub: "1 new · passwords are not part of exports" });

    h.files.readText.mockResolvedValue(JSON.stringify([conn()]));
    await importConnectionsFromFile();
    expect(toast()?.title).toBe("Imported 1 connection");
  });

  it("reports bad files", async () => {
    h.pickOpen.mockResolvedValue("/c.json");
    h.files.readText.mockResolvedValue(JSON.stringify({ other: 1 }));
    await importConnectionsFromFile();
    expect(toast()).toMatchObject({ tone: "err", title: "Import failed", sub: "expected { connections: [...] }" });

    h.files.readText.mockRejectedValue("disk gone");
    await importConnectionsFromFile();
    expect(toast()?.sub).toBe("disk gone");
  });
});

describe("exportConnectionsToFile", () => {
  it("exports every connection without secrets", async () => {
    h.pickSave.mockResolvedValue("/out.json");
    await exportConnectionsToFile();
    expect(h.pickSave.mock.calls[0][0]).toBe("mq-viewer-connections.json");
    expect(written()).toEqual({ version: 1, connections: [conn()] });
    expect(toast()).toMatchObject({ title: "Exported 1 connection", sub: "/out.json" });
  });

  it("names a single export after the connection", async () => {
    h.pickSave.mockResolvedValue("/x.json");
    await exportConnectionsToFile([conn({ name: "Prod" })]);
    expect(h.pickSave.mock.calls[0][0]).toBe("Prod.json");
    await exportConnectionsToFile([conn({ name: "" })]);
    expect(h.pickSave.mock.calls[1][0]).toBe("connection.json");
    await exportConnectionsToFile([conn(), conn({ id: "c2" })]);
    expect(toast()?.title).toBe("Exported 2 connections");
  });

  it("stops when the dialog is cancelled", async () => {
    h.pickSave.mockResolvedValue(null);
    await exportConnectionsToFile();
    expect(h.files.writeText).not.toHaveBeenCalled();
  });
});

describe("exportMessages", () => {
  it("skips an empty selection and a cancelled dialog", async () => {
    await exportMessages("Q", []);
    expect(h.pickSave).not.toHaveBeenCalled();
    h.pickSave.mockResolvedValue(null);
    await exportMessages("Q", [message("A")]);
    expect(h.files.writeText).not.toHaveBeenCalled();
  });

  it("writes MQMD, properties and payload", async () => {
    h.pickSave.mockResolvedValue("/m.json");
    await exportMessages("Q", [message("A"), message("B")]);
    expect(h.pickSave.mock.calls[0][0]).toBe("Q-2-messages.json");
    const out = written();
    expect(out.queue).toBe("Q");
    expect(out.messages[0]).toMatchObject({ msgId: "A", mqmd: { Format: "MQSTR" }, text: "hi", base64: "aGk=" });
    expect(toast()?.title).toBe("Exported 2 messages");
    await exportMessages("Q", [message("A")]);
    expect(toast()?.title).toBe("Exported 1 message");
  });
});

describe("savePayload", () => {
  it.each([["json", "json"], ["xml", "xml"], ["text", "txt"], ["binary", "bin"]] as const)("uses .%s → .%s", async (kind, ext) => {
    h.pickSave.mockResolvedValue(`/p.${ext}`);
    await savePayload(message("0123456789ABCDEF0123", { kind }));
    expect(h.pickSave).toHaveBeenCalledWith(`456789ABCDEF0123.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    expect(h.files.writeBase64).toHaveBeenCalledWith(`/p.${ext}`, "aGk=");
    expect(toast()).toMatchObject({ title: "Payload saved", sub: `2 bytes · /p.${ext}` });
  });

  it("stops when the dialog is cancelled", async () => {
    h.pickSave.mockResolvedValue(null);
    await savePayload(message("A"));
    expect(h.files.writeBase64).not.toHaveBeenCalled();
  });
});

describe("pickPayloadFile", () => {
  it("returns null when cancelled", async () => {
    h.pickOpen.mockResolvedValue(null);
    expect(await pickPayloadFile()).toBeNull();
  });

  it("decodes UTF-8 text and keeps binary as base64 only", async () => {
    h.pickOpen.mockResolvedValue("C:\\data\\msg.json");
    h.files.readBase64.mockResolvedValue("aGk=");
    expect(await pickPayloadFile()).toEqual({ name: "msg.json", base64: "aGk=", text: "hi" });

    h.pickOpen.mockResolvedValue("/data/blob.bin");
    h.files.readBase64.mockResolvedValue("/w==");
    expect(await pickPayloadFile()).toEqual({ name: "blob.bin", base64: "/w==", text: null });
  });
});

describe("pickKeystore", () => {
  it("offers keystore types", async () => {
    h.pickOpen.mockResolvedValue("/k.p12");
    expect(await pickKeystore()).toBe("/k.p12");
    expect(h.pickOpen.mock.calls[0][0][0].extensions).toContain("p12");
  });
});
