import { describe, expect, it } from "vitest";
import { hexRows, jsonLines, prettyXml, tokenizeJsonText, tokenizeXmlText, xmlLines, type Line, type Tok } from "./highlight";

const text = (l: Line) => l.toks.map((t) => t.t).join("");
const joined = (toks: Tok[]) => toks.map((t) => t.t).join("");

describe("jsonLines", () => {
  it("pretty-prints nested values with numbered lines", () => {
    const lines = jsonLines({ a: 1, b: "x", c: [true, null], d: {}, e: [] });
    expect(lines.map(text)).toEqual([
      "{",
      '  "a": 1,',
      '  "b": "x",',
      '  "c": [',
      "    true,",
      "    null",
      "  ],",
      '  "d": {},',
      '  "e": []',
      "}",
    ]);
    expect(lines[0].n).toBe(1);
    expect(lines[1].toks.find((t) => t.t === '"a"')!.c).toBe("var(--syn-key)");
    expect(lines[1].toks.find((t) => t.t === "1")!.c).toBe("var(--syn-num)");
    expect(lines[2].toks.find((t) => t.t === '"x"')!.c).toBe("var(--syn-str)");
    expect(lines[4].toks.find((t) => t.t === "true")!.c).toBe("var(--syn-bool)");
  });

  it("handles a bare scalar", () => {
    expect(jsonLines(42).map(text)).toEqual(["42"]);
  });
});

describe("xmlLines / prettyXml", () => {
  it("indents elements, keeps the declaration, attributes, text and CDATA", () => {
    const xml = '<?xml version="1.0"?><order id="7"><sku>A1</sku><empty/><note><![CDATA[x<y]]></note>mixed<b>1</b></order>';
    expect(prettyXml(xml)).toBe([
      '<?xml version="1.0"?>',
      '<order id="7">',
      "  <sku>A1</sku>",
      "  <empty/>",
      "  <note>x<y</note>",
      "  mixed",
      "  <b>1</b>",
      "</order>",
    ].join("\n"));
    const lines = xmlLines(xml)!;
    expect(lines[1].toks.find((t) => t.t === ' id')!.c).toBe("var(--syn-num)");
  });

  it("returns null for malformed XML", () => {
    expect(xmlLines("<a><b></a>")).toBeNull();
    expect(prettyXml("<a>")).toBeNull();
  });
});

describe("hexRows", () => {
  it("renders offset, two hex groups and ASCII", () => {
    const bytes = new Uint8Array([...Array(18)].map((_, i) => (i === 1 ? 1 : 65 + i)));
    const rows = hexRows(bytes);
    expect(rows).toHaveLength(2);
    expect(rows[0].off).toBe("000000");
    expect(rows[0].hex).toBe("41 01 43 44 45 46 47 48  49 4A 4B 4C 4D 4E 4F 50");
    expect(rows[0].asc).toBe("A.CDEFGHIJKLMNOP");
    expect(rows[1].off).toBe("000010");
    expect(rows[1].hex).toHaveLength(48);
  });

  it("stops at maxRows", () => {
    expect(hexRows(new Uint8Array(100), 2)).toHaveLength(2);
  });
});

describe("tokenizeJsonText", () => {
  it("colours keys, strings, numbers, literals and punctuation without needing valid JSON", () => {
    const [line, second] = tokenizeJsonText('{"k": "v", "n": -1.5e3, "b": false, x\n]');
    expect(joined(line)).toBe('{"k": "v", "n": -1.5e3, "b": false, x');
    const c = (t: string) => line.find((x) => x.t === t)!.c;
    expect(c('"k"')).toBe("var(--syn-key)");
    expect(c('"v"')).toBe("var(--syn-str)");
    expect(c("-1.5e3")).toBe("var(--syn-num)");
    expect(c("false")).toBe("var(--syn-bool)");
    expect(c("{")).toBe("var(--syn-punc)");
    expect(c("x")).toBe("var(--text)");
    expect(joined(second)).toBe("]");
  });
});

describe("tokenizeXmlText", () => {
  it("colours tags, attributes and values inside tags only", () => {
    const [line] = tokenizeXmlText('<?xml v="1"?><a id="2">text "q"</a>');
    expect(joined(line)).toBe('<?xml v="1"?><a id="2">text "q"</a>');
    const all = (t: string) => line.filter((x) => x.t === t).map((x) => x.c);
    expect(all("a")).toEqual(["var(--syn-key)", "var(--syn-key)"]);
    expect(all("id")).toEqual(["var(--syn-num)"]);
    expect(all('"2"')).toEqual(["var(--syn-str)"]);
    expect(all('"q"')).toEqual(["var(--text)"]);
    expect(all("text")).toEqual(["var(--text)"]);
    expect(all("=")).toEqual(["var(--syn-punc)", "var(--syn-punc)"]);
    expect(all("<?")).toEqual(["var(--syn-punc)"]);
  });
});
