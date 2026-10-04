import type { Env } from "./types";

export const n = (x: number) => x.toLocaleString("en-US");

export function bytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const pad = (v: number, w = 2) => String(v).padStart(w, "0");

/** HH:MM:SS.mmm in local time, as the browse grid shows it. */
export function timeOf(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function dateOf(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function clock(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const isZeroId = (hex: string) => /^0*$/.test(hex);

/** "414D51…" + the distinguishing tail, as in the design's MESSAGE ID column. */
export function idTail(hex: string, len = 16) {
  return hex.length > len ? hex.slice(-len) : hex;
}

/** Hex without the null padding MQ adds to text ids ("ORDER-42" → 4F524445522D3432). */
export function trimId(hex: string) {
  return hex.replace(/(00)+$/, "");
}

/** The id as text when it is printable ASCII padded with nulls, e.g. a CorrelId set from a string. */
export function idText(hex: string): string | null {
  const t = trimId(hex);
  if (!t || t.length === hex.length) return null;
  let s = "";
  for (let i = 0; i < t.length; i += 2) {
    const c = parseInt(t.slice(i, i + 2), 16);
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Short form for the CORREL ID column. */
export function correlShow(hex: string) {
  const text = idText(hex);
  if (text) return `"${text}"`;
  const t = trimId(hex);
  return t.length <= 12 ? t : `…${t.slice(-12)}`;
}

export function shortId(hex: string) {
  return hex.length > 22 ? `${hex.slice(0, 6)}…${hex.slice(-16)}` : hex;
}

export const ENV_COLOR: Record<Env, string> = { DEV: "var(--ok)", TEST: "var(--warn)", PROD: "var(--prod)" };

export const SWATCHES = [
  "oklch(0.62 0.2 25)", "oklch(0.78 0.14 70)", "oklch(0.72 0.14 150)",
  "oklch(0.74 0.12 200)", "oklch(0.64 0.15 270)", "oklch(0.68 0.15 330)",
];

export function platformLabel(p: string | null) {
  if (!p) return null;
  return p.replace(/^MQPL_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function tlsLabel(protocol: string | null) {
  if (!protocol) return null;
  return protocol.replace(/^TLSv/, "TLS ");
}

/** Escape a user pattern for a case-insensitive "contains" match unless regex mode is on. */
export function matcher(query: string, regex: boolean): ((s: string) => boolean) | null {
  if (!query) return null;
  if (regex) {
    try {
      const re = new RegExp(query, "i");
      return (s) => re.test(s);
    } catch {
      return () => false;
    }
  }
  const qq = query.toLowerCase();
  return (s) => s.toLowerCase().includes(qq);
}

/** MQ-style wildcard filter used by the queue list (PAYMENTS.*). */
export function wildcard(pattern: string): (s: string) => boolean {
  const p = pattern.trim();
  if (!p) return () => true;
  if (!p.includes("*")) return (s) => s.toLowerCase().includes(p.toLowerCase());
  const re = new RegExp("^" + p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return (s) => re.test(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
