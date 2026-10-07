import { afterEach, describe, expect, it, vi } from "vitest";
import { errorText, FUNCTIONS, hasTemplate, parseTemplate, renderBodies, renderTemplate, templateForFormat } from "./template";

const one = (src: string, i = 0, count = 1) => renderTemplate(parseTemplate(src), i, count);

afterEach(() => vi.useRealTimers());

describe("parseTemplate", () => {
  it("splits literals and calls with offsets", () => {
    const p = parseTemplate('a{{ index( 5 , 3 ) }}b{{pick("x\\"y", \'z\')}}');
    expect(p.errors).toEqual([]);
    expect(p.calls).toEqual([
      { name: "index", args: [5, 3], start: 1, end: 21 },
      { name: "pick", args: ['x"y', "z"], start: 22, end: 43 },
    ]);
    expect(p.parts.map((x) => x.kind)).toEqual(["text", "call", "text", "call"]);
  });

  it("accepts a call without parentheses and empty parentheses", () => {
    expect(parseTemplate("{{uuid}}{{timestamp()}}").calls.map((c) => c.name)).toEqual(["uuid", "timestamp"]);
  });

  it("treats \\{{ as a literal {{", () => {
    const p = parseTemplate("x \\{{index}} y");
    expect(p.calls).toEqual([]);
    expect(renderTemplate(p, 0, 1)).toBe("x {{index}} y");
  });

  it.each([
    ["{{nope()}}", "Unknown function nope()"],
    ["{{constructor}}", "Unknown function constructor()"],
    ["{{ }}", "Expected a function name after {{"],
    ["{{index('x')}}", "Usage: index(start = 1, width = 0)"],
    ["{{uuid(1)}}", "uuid() takes 0 arguments"],
    ["{{pick()}}", "Usage: pick(a, b, …)"],
    ["{{randomNumber(1,", "Bad argument in randomNumber(…): use a number or a 'string'"],
    ["{{now('abc)}}", "Unterminated string"],
    ["{{index(1 2)}}", "Expected , or ) in index(…)"],
    ["{{index(1)", "Expected }}"],
    ["{{index", "Expected }}"],
  ])("reports %s", (src, message) => {
    const p = parseTemplate(src);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].message).toBe(message);
    expect(p.errors[0].start).toBe(0);
    expect(p.errors[0].end).toBeGreaterThanOrEqual(2);
  });

  it("does not let an error run past the end of its line, and keeps going after it", () => {
    const p = parseTemplate("{{bad\n{{index}}");
    expect(p.errors[0]).toMatchObject({ start: 0, end: 5 });
    expect(p.calls).toHaveLength(1);
    expect(renderTemplate(p, 0, 1)).toBe("{{bad\n1");
  });
});

describe("functions", () => {
  it("index counts from start and pads", () => {
    expect([0, 1, 2].map((i) => one("{{index()}}", i, 3))).toEqual(["1", "2", "3"]);
    expect(one("{{index(10, 4)}}", 2)).toBe("0012");
  });

  it("randomNumber stays in range, with swapped bounds and defaults", () => {
    for (let k = 0; k < 50; k++) {
      const v = Number(one("{{randomNumber(5, 1)}}"));
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(Number(one("{{randomNumber}}"))).toBeLessThanOrEqual(999999);
  });

  it("randomDecimal keeps the digits", () => {
    expect(one("{{randomDecimal(1, 2, 3)}}")).toMatch(/^[12]\.\d{3}$/);
    expect(one("{{randomDecimal}}")).toMatch(/^0\.\d\d$|^1\.00$/);
  });

  it("random strings have the requested length and alphabet", () => {
    expect(one("{{randomString}}")).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(one("{{randomString(3)}}")).toHaveLength(3);
    expect(one("{{randomString(-1)}}")).toBe("");
    expect(one("{{randomHex}}")).toMatch(/^[0-9A-F]{16}$/);
    expect(one("{{randomHex(4)}}")).toMatch(/^[0-9A-F]{4}$/);
  });

  it("uuid and pick", () => {
    expect(one("{{uuid()}}")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(["a", "1"]).toContain(one("{{pick('a', 1)}}"));
  });

  it("now and timestamp use the current time", () => {
    vi.useFakeTimers();
    const d = new Date(2026, 9, 7, 8, 5, 3, 7);
    vi.setSystemTime(d);
    expect(one("{{now()}}")).toBe(d.toISOString());
    expect(one("{{now('yyyy-MM-dd HH:mm:ss.SSS')}}")).toBe("2026-10-07 08:05:03.007");
    expect(one("{{timestamp()}}")).toBe(String(d.getTime()));
  });

  it("every function has help text and an example that parses", () => {
    for (const [name, f] of Object.entries(FUNCTIONS)) {
      expect(f.signature.startsWith(name)).toBe(true);
      expect(f.description).not.toBe("");
      expect(parseTemplate(`{{${f.example}}}`).errors).toEqual([]);
    }
  });
});

describe("rendering batches", () => {
  it("hasTemplate is a cheap check", () => {
    expect(hasTemplate("a {{ b")).toBe(true);
    expect(hasTemplate("{ }")).toBe(false);
  });

  it("renders one body per message with fresh values", () => {
    const bodies = renderBodies('{"id":"{{uuid()}}","n":{{index()}}}', 5).map((b) => JSON.parse(b));
    expect(new Set(bodies.map((b) => b.id)).size).toBe(5);
    expect(bodies.map((b) => b.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws the first error with its position", () => {
    expect(() => renderBodies("ok\n  {{nope}}", 2)).toThrow("Unknown function nope() (Ln 2, Col 3)");
  });

  it("errorText reports line and column", () => {
    const src = "a\nbc{{x";
    expect(errorText(src, parseTemplate(src).errors[0])).toBe("Expected }} (Ln 2, Col 3)");
  });
});

describe("templateForFormat", () => {
  it("lets a formatter run over expressions and restores them", () => {
    const src = '{"id":"{{uuid()}}","n":{{index()}},"x":{{randomNumber(1,2)}}}';
    const f = templateForFormat(src);
    expect(() => JSON.parse(f.text)).not.toThrow();
    const pretty = f.restore(JSON.stringify(JSON.parse(f.text), null, 2));
    expect(pretty).toContain('"id": "{{uuid()}}"');
    expect(pretty).toContain('"n": {{index()}}');
    expect(parseTemplate(pretty).calls).toHaveLength(3);
  });

  it("is the identity without expressions", () => {
    const f = templateForFormat("plain");
    expect(f.text).toBe("plain");
    expect(f.restore("plain")).toBe("plain");
  });
});
