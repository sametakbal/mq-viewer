// Making ASCII control characters visible: CR/LF line endings, SOH/STX/ETX framing, TAB, NUL…

const NAMES = [
  "NUL", "SOH", "STX", "ETX", "EOT", "ENQ", "ACK", "BEL", "BS", "TAB", "LF", "VT", "FF", "CR", "SO", "SI",
  "DLE", "DC1", "DC2", "DC3", "DC4", "NAK", "SYN", "ETB", "CAN", "EM", "SUB", "ESC", "FS", "GS", "RS", "US",
];

export function controlName(code: number): string | null {
  if (code < 32) return NAMES[code];
  if (code === 127) return "DEL";
  return null;
}

const isControl = (code: number) => code < 32 || code === 127;

/** One-glyph form for tight spaces (grid preview, hex ASCII column): ␍ ␊ ␁ ␂ ␃ … ␡ */
export function controlPicture(code: number): string {
  return String.fromCharCode(code === 127 ? 0x2421 : 0x2400 + code);
}

export function withControlPictures(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    out += isControl(c) ? controlPicture(c) : ch;
  }
  return out;
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "ctl"; name: string; code: number; lineEnd: boolean; breakAfter: boolean };

/** Splits text into plain runs and control characters; a line break follows LF, and CR not followed by LF. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let run = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (!isControl(c)) {
      run += text[i];
      continue;
    }
    if (run) out.push({ kind: "text", text: run });
    run = "";
    const lineEnd = c === 10 || c === 13;
    const breakAfter = c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10);
    out.push({ kind: "ctl", name: controlName(c)!, code: c, lineEnd, breakAfter });
  }
  if (run) out.push({ kind: "text", text: run });
  return out;
}

/** Short description for the toolbar, e.g. "CRLF · SOH×4 · STX · ETX". */
export function controlSummary(text: string): string {
  let crlf = 0, lf = 0, cr = 0;
  const others = new Map<string, number>();
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13 && text.charCodeAt(i + 1) === 10) {
      crlf++;
      i++;
    } else if (c === 10) lf++;
    else if (c === 13) cr++;
    else if (isControl(c)) {
      const n = controlName(c)!;
      others.set(n, (others.get(n) ?? 0) + 1);
    }
  }
  const endings = [crlf && "CRLF", lf && "LF", cr && "CR"].filter(Boolean) as string[];
  const parts = endings.length > 1 ? [`mixed ${endings.join("/")}`] : endings;
  for (const [n, k] of others) parts.push(k > 1 ? `${n}×${k}` : n);
  return parts.length ? parts.join(" · ") : "no control characters";
}
