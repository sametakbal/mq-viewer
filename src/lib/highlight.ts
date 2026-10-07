// Syntax-coloured line model for payloads, ported from the design's jsonLines/xmlLines/hexRows.

export interface Tok {
  t: string;
  c: string;
}

export interface Line {
  n: number;
  toks: Tok[];
}

const P = (t: string): Tok => ({ t, c: "var(--syn-punc)" });
const ind = (d: number): Tok => ({ t: "  ".repeat(d), c: "inherit" });

function scalar(v: unknown): Tok {
  if (typeof v === "string") return { t: JSON.stringify(v), c: "var(--syn-str)" };
  if (typeof v === "number") return { t: String(v), c: "var(--syn-num)" };
  return { t: String(v), c: "var(--syn-bool)" };
}

export function jsonLines(value: unknown): Line[] {
  const lines: Tok[][] = [];
  const walk = (val: unknown, d: number, key: string | null, tr: string) => {
    const pre: Tok[] = [ind(d)];
    if (key !== null) pre.push({ t: JSON.stringify(key), c: "var(--syn-key)" }, P(": "));
    if (val && typeof val === "object") {
      const arr = Array.isArray(val);
      const ent: [string | null, unknown][] = arr ? (val as unknown[]).map((x) => [null, x]) : Object.entries(val as object);
      if (ent.length === 0) {
        lines.push([...pre, P((arr ? "[]" : "{}") + tr)]);
        return;
      }
      lines.push([...pre, P(arr ? "[" : "{")]);
      ent.forEach(([k, x], i) => walk(x, d + 1, k, i < ent.length - 1 ? "," : ""));
      lines.push([ind(d), P((arr ? "]" : "}") + tr)]);
    } else lines.push([...pre, scalar(val), P(tr)]);
  };
  walk(value, 0, null, "");
  return lines.map((toks, i) => ({ n: i + 1, toks }));
}

/** Pretty-prints and colours XML; returns null when the text is not well-formed. */
export function xmlLines(text: string): Line[] | null {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  const out: Tok[][] = [];
  const decl = /^\s*<\?xml[^>]*\?>/.exec(text);
  if (decl) out.push([P(decl[0].trim())]);
  const K = "var(--syn-key)";
  const walk = (el: Element, d: number) => {
    const open: Tok[] = [ind(d), P("<"), { t: el.tagName, c: K }];
    for (const a of Array.from(el.attributes)) {
      open.push({ t: " " + a.name, c: "var(--syn-num)" }, P("="), { t: `"${a.value}"`, c: "var(--syn-str)" });
    }
    const kids = Array.from(el.childNodes).filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.textContent!.trim()) || c.nodeType === 4);
    const close: Tok[] = [P("</"), { t: el.tagName, c: K }, P(">")];
    if (kids.length === 0) {
      out.push([...open, P("/>")]);
    } else if (kids.length === 1 && kids[0].nodeType !== 1) {
      out.push([...open, P(">"), { t: kids[0].textContent!.trim(), c: "var(--text)" }, ...close]);
    } else {
      out.push([...open, P(">")]);
      for (const k of kids) {
        if (k.nodeType === 1) walk(k as Element, d + 1);
        else out.push([ind(d + 1), { t: k.textContent!.trim(), c: "var(--text)" }]);
      }
      out.push([ind(d), ...close]);
    }
  };
  walk(doc.documentElement, 0);
  return out.map((toks, i) => ({ n: i + 1, toks }));
}

export function prettyXml(text: string): string | null {
  const ls = xmlLines(text);
  return ls ? ls.map((l) => l.toks.map((t) => t.t).join("")).join("\n") : null;
}

export interface HexRow {
  off: string;
  hex: string;
  asc: string;
}

export function hexRows(bytes: Uint8Array, maxRows = 1024): HexRow[] {
  const rows: HexRow[] = [];
  const h = (x: number) => x.toString(16).padStart(2, "0").toUpperCase();
  for (let o = 0; o < bytes.length && rows.length < maxRows; o += 16) {
    const ch = Array.from(bytes.subarray(o, o + 16));
    rows.push({
      off: o.toString(16).padStart(6, "0").toUpperCase(),
      hex: (ch.slice(0, 8).map(h).join(" ") + "  " + ch.slice(8).map(h).join(" ")).padEnd(48, " "),
      asc: ch.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join(""),
    });
  }
  return rows;
}

/** Light tokenizer for the Put editor: colours JSON without needing it to be valid. */
export function tokenizeJsonText(text: string): Tok[][] {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])|(\s+)|(.)/g;
  return text.split("\n").map((line) => {
    const toks: Tok[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      if (m[1]) {
        toks.push({ t: m[1], c: m[2] ? "var(--syn-key)" : "var(--syn-str)" });
        if (m[2]) toks.push(P(m[2]));
      } else if (m[3]) toks.push({ t: m[3], c: "var(--syn-num)" });
      else if (m[4]) toks.push({ t: m[4], c: "var(--syn-bool)" });
      else if (m[5]) toks.push(P(m[5]));
      else toks.push({ t: m[0], c: "var(--text)" });
    }
    return toks;
  });
}

export function tokenizeXmlText(text: string): Tok[][] {
  const re = /(<\?|\?>|<\/?|\/?>)|("[^"]*")|([\w:.-]+)(?==)|(=)|([\w:.-]+)|(\s+)|(.)/g;
  return text.split("\n").map((line) => {
    const toks: Tok[] = [];
    let inTag = false;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      if (m[1]) {
        inTag = !m[1].endsWith(">");
        toks.push(P(m[1]));
      } else if (m[2]) toks.push({ t: m[2], c: inTag ? "var(--syn-str)" : "var(--text)" });
      else if (m[3]) toks.push({ t: m[3], c: "var(--syn-num)" });
      else if (m[4]) toks.push(P(m[4]));
      else if (m[5]) toks.push({ t: m[5], c: inTag ? "var(--syn-key)" : "var(--text)" });
      else toks.push({ t: m[0], c: "var(--text)" });
    }
    return toks;
  });
}
