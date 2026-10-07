import { afterEach, describe, expect, it, vi } from "vitest";
import {
  b64ToBytes, bytes, bytesToB64, clock, copyText, correlShow, dateOf, idTail, idText, isZeroId, matcher, n, platformLabel,
  shortId, timeOf, tlsLabel, trimId, uid, wildcard,
} from "./format";

describe("numbers and sizes", () => {
  it("formats with thousands separators", () => {
    expect(n(1234567)).toBe("1,234,567");
  });

  it("picks B, KB or MB", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(2048)).toBe("2.0 KB");
    expect(bytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("times", () => {
  const iso = new Date(2026, 9, 7, 8, 5, 3, 7).toISOString();

  it("shows local time with milliseconds", () => {
    expect(timeOf(iso)).toBe("08:05:03.007");
    expect(timeOf(null)).toBe("—");
  });

  it("shows the local date", () => {
    expect(dateOf(iso)).toBe("2026-10-07");
    expect(dateOf(null)).toBe("");
  });

  it("formats a clock", () => {
    expect(clock(new Date(2026, 0, 1, 9, 0, 59))).toBe("09:00:59");
    expect(clock()).toMatch(/^\d\d:\d\d:\d\d$/);
  });
});

describe("message ids", () => {
  const text = "4F524445522D3432" + "00".repeat(16); // "ORDER-42" padded

  it("detects all-zero ids", () => {
    expect(isZeroId("000000")).toBe(true);
    expect(isZeroId("000100")).toBe(false);
  });

  it("keeps the tail", () => {
    expect(idTail("0123456789ABCDEF0123")).toBe("456789ABCDEF0123");
    expect(idTail("ABC")).toBe("ABC");
    expect(idTail("ABCDEF", 4)).toBe("CDEF");
  });

  it("trims null padding", () => {
    expect(trimId(text)).toBe("4F524445522D3432");
  });

  it("reads printable padded ids as text", () => {
    expect(idText(text)).toBe("ORDER-42");
    expect(idText("4F52")).toBeNull(); // no padding
    expect(idText("0000")).toBeNull(); // empty after trim
    expect(idText("4F01" + "0000")).toBeNull(); // non-printable byte
  });

  it("shows correl ids compactly", () => {
    expect(correlShow(text)).toBe('"ORDER-42"');
    expect(correlShow("ABCDEF")).toBe("ABCDEF");
    expect(correlShow("0123456789ABCDEF0123")).toBe("…89ABCDEF0123");
  });

  it("shortens long ids", () => {
    expect(shortId("414D5120514D31202020202020202020")).toBe("414D51…2020202020202020");
    expect(shortId("ABC")).toBe("ABC");
  });
});

describe("labels", () => {
  it("prettifies platform names", () => {
    expect(platformLabel("MQPL_UNIX")).toBe("Unix");
    expect(platformLabel("MQPL_WINDOWS_NT")).toBe("Windows nt");
    expect(platformLabel(null)).toBeNull();
  });

  it("prettifies TLS protocols", () => {
    expect(tlsLabel("TLSv1.3")).toBe("TLS 1.3");
    expect(tlsLabel(null)).toBeNull();
  });
});

describe("matching", () => {
  it("returns null for an empty query", () => {
    expect(matcher("", false)).toBeNull();
  });

  it("matches case-insensitively as plain text", () => {
    const m = matcher("Pay.", false)!;
    expect(m("PAY.IN")).toBe(true);
    expect(m("PAYXIN")).toBe(false);
  });

  it("matches regexes and treats a bad one as no match", () => {
    expect(matcher("^pay\\d+$", true)!("PAY42")).toBe(true);
    expect(matcher("(", true)!("anything")).toBe(false);
  });

  it("filters with MQ-style wildcards", () => {
    expect(wildcard("  ")("X")).toBe(true);
    expect(wildcard("pay")("PAYMENTS.IN")).toBe(true);
    expect(wildcard("PAYMENTS.*")("payments.in")).toBe(true);
    expect(wildcard("PAYMENTS.*")("PAYMENTSXIN")).toBe(false);
    expect(wildcard("*.IN")("ORDERS.IN")).toBe(true);
  });
});

describe("base64", () => {
  it("round-trips bytes, including large buffers", () => {
    const big = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 256);
    expect(b64ToBytes(bytesToB64(big))).toEqual(big);
    expect(bytesToB64(new Uint8Array([104, 105]))).toBe("aGk=");
  });
});

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the clipboard API fails", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    await copyText("fallback");
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});

describe("uid", () => {
  it("uses randomUUID when available", () => {
    expect(uid()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("falls back without randomUUID", () => {
    const orig = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(uid()).toMatch(/^[0-9a-z]+$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: orig, configurable: true });
    }
  });
});
