// Body templates: `{{ fn(args) }}` expressions evaluated once per message, so a batch of N messages can differ.
// Only the built-in functions below can be called, with number or string literal arguments — nothing is eval'd.

export type Arg = number | string;
export type Call = { name: string; args: Arg[]; start: number; end: number };
export type TemplateError = { message: string; start: number; end: number };
export type Part = { kind: "text"; text: string } | ({ kind: "call" } & Call);
export type Parsed = { parts: Part[]; calls: Call[]; errors: TemplateError[] };

type Ctx = { i: number; count: number };
type Fn = {
  signature: string;
  description: string;
  example: string;
  params: ("number" | "string")[];
  required: number;
  variadic?: boolean;
  run: (args: Arg[], ctx: Ctx) => string;
};

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** Uniform in [0, 1) from the Web Crypto generator. */
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const randIndex = (n: number) => Math.floor(random() * n);
const randInt = (min: number, max: number) => {
  const lo = Math.ceil(Math.min(min, max)), hi = Math.floor(Math.max(min, max));
  return lo + randIndex(hi - lo + 1);
};
const randFrom = (chars: string, len: number) => {
  let s = "";
  for (let k = 0; k < Math.max(0, len); k++) s += chars[randIndex(chars.length)];
  return s;
};
const pad = (v: number, w: number) => String(v).padStart(w, "0");

function formatDate(d: Date, fmt: string): string {
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss|SSS/g, (t) => {
    switch (t) {
      case "yyyy": return String(d.getFullYear());
      case "MM": return pad(d.getMonth() + 1, 2);
      case "dd": return pad(d.getDate(), 2);
      case "HH": return pad(d.getHours(), 2);
      case "mm": return pad(d.getMinutes(), 2);
      case "ss": return pad(d.getSeconds(), 2);
      default: return pad(d.getMilliseconds(), 3);
    }
  });
}

export const FUNCTIONS: Record<string, Fn> = {
  index: {
    signature: "index(start = 1, width = 0)", description: "Position in the batch: start, start+1, … zero-padded to width",
    example: "index()", params: ["number", "number"], required: 0,
    run: ([start = 1, width = 0], { i }) => pad(Number(start) + i, Number(width)),
  },
  randomNumber: {
    signature: "randomNumber(min = 0, max = 999999)", description: "Random integer, both ends inclusive",
    example: "randomNumber(1, 1000)", params: ["number", "number"], required: 0,
    run: ([min = 0, max = 999999]) => String(randInt(Number(min), Number(max))),
  },
  randomDecimal: {
    signature: "randomDecimal(min = 0, max = 1, digits = 2)", description: "Random decimal with a fixed number of digits",
    example: "randomDecimal(10, 500, 2)", params: ["number", "number", "number"], required: 0,
    run: ([min = 0, max = 1, digits = 2]) => (Number(min) + random() * (Number(max) - Number(min))).toFixed(Math.max(0, Math.min(20, Number(digits)))),
  },
  randomString: {
    signature: "randomString(length = 8)", description: "Random letters and digits",
    example: "randomString(8)", params: ["number"], required: 0,
    run: ([len = 8]) => randFrom(ALNUM, Number(len)),
  },
  randomHex: {
    signature: "randomHex(length = 16)", description: "Random hex digits (0-9, A-F)",
    example: "randomHex(16)", params: ["number"], required: 0,
    run: ([len = 16]) => randFrom("0123456789ABCDEF", Number(len)),
  },
  uuid: {
    signature: "uuid()", description: "Random UUID v4",
    example: "uuid()", params: [], required: 0,
    run: () => crypto.randomUUID(),
  },
  pick: {
    signature: "pick(a, b, …)", description: "One of the arguments, chosen at random",
    example: "pick('EUR', 'USD', 'TRY')", params: [], required: 1, variadic: true,
    run: (args) => String(args[randIndex(args.length)]),
  },
  now: {
    signature: "now(format?)", description: "Current time; ISO 8601 (UTC) by default, or local time with yyyy MM dd HH mm ss SSS",
    example: "now('yyyy-MM-dd HH:mm:ss')", params: ["string"], required: 0,
    run: ([fmt]) => (fmt == null ? new Date().toISOString() : formatDate(new Date(), String(fmt))),
  },
  timestamp: {
    signature: "timestamp()", description: "Current time in epoch milliseconds",
    example: "timestamp()", params: [], required: 0,
    run: () => String(Date.now()),
  },
};

export const hasTemplate = (text: string) => text.includes("{{");

/** Parses one expression starting right after `{{`; returns the call and the offset after `}}`, or an error. */
function parseExpr(text: string, from: number): { call: Call; next: number } | TemplateError {
  const start = from - 2;
  let i = from;
  const lineEnd = (() => {
    const n = text.indexOf("\n", from);
    return n < 0 ? text.length : n;
  })();
  const fail = (message: string, end = lineEnd): TemplateError => ({ message, start, end: Math.max(end, start + 2) });
  const ws = () => {
    while (i < lineEnd && (text[i] === " " || text[i] === "\t")) i++;
  };

  ws();
  const id = /^[A-Za-z_]\w*/.exec(text.slice(i, lineEnd));
  if (!id) return fail("Expected a function name after {{");
  const name = id[0];
  i += name.length;
  ws();
  const args: Arg[] = [];
  if (text[i] === "(") {
    i++;
    ws();
    if (text[i] === ")") i++;
    else {
      for (;;) {
        ws();
        const num = /^-?\d+(?:\.\d+)?/.exec(text.slice(i, lineEnd));
        if (num) {
          args.push(Number(num[0]));
          i += num[0].length;
        } else if (text[i] === "'" || text[i] === '"') {
          const q = text[i++];
          let s = "";
          while (i < lineEnd && text[i] !== q) {
            if (text[i] === "\\" && i + 1 < lineEnd) i++;
            s += text[i++];
          }
          if (text[i] !== q) return fail("Unterminated string");
          i++;
          args.push(s);
        } else return fail(`Bad argument in ${name}(…): use a number or a 'string'`);
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === ")") { i++; break; }
        return fail(`Expected , or ) in ${name}(…)`);
      }
    }
    ws();
  }
  if (!text.startsWith("}}", i)) return fail("Expected }}");
  const next = i + 2;

  const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
  if (!fn) return fail(`Unknown function ${name}()`, next);
  const max = fn.variadic ? Infinity : fn.params.length;
  if (args.length < fn.required || args.length > max) {
    return fail(fn.required === max ? `${name}() takes ${max} argument${max === 1 ? "" : "s"}` : `Usage: ${fn.signature}`, next);
  }
  for (let k = 0; k < args.length && k < fn.params.length; k++) {
    if (typeof args[k] !== fn.params[k]) return fail(`Usage: ${fn.signature}`, next);
  }
  return { call: { name, args, start, end: next }, next };
}

/** Splits a body into literal text and `{{ … }}` calls. `\{{` stands for a literal `{{`. */
export function parseTemplate(text: string): Parsed {
  const parts: Part[] = [], calls: Call[] = [], errors: TemplateError[] = [];
  let run = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("\\{{", i)) {
      run += "{{";
      i += 3;
    } else if (text.startsWith("{{", i)) {
      const r = parseExpr(text, i + 2);
      if ("call" in r) {
        if (run) parts.push({ kind: "text", text: run });
        run = "";
        parts.push({ kind: "call", ...r.call });
        calls.push(r.call);
        i = r.next;
      } else {
        errors.push(r);
        run += "{{";
        i += 2;
      }
    } else run += text[i++];
  }
  if (run) parts.push({ kind: "text", text: run });
  return { parts, calls, errors };
}

/** Renders message `i` (0-based) of a batch of `count`. */
export function renderTemplate(p: Parsed, i: number, count: number): string {
  let out = "";
  for (const part of p.parts) out += part.kind === "text" ? part.text : FUNCTIONS[part.name].run(part.args, { i, count });
  return out;
}

export function errorText(text: string, e: TemplateError): string {
  const before = text.slice(0, e.start);
  return `${e.message} (Ln ${before.split("\n").length}, Col ${e.start - before.lastIndexOf("\n")})`;
}

/** One body per message; throws on a template error. */
export function renderBodies(text: string, count: number): string[] {
  const p = parseTemplate(text);
  if (p.errors.length) throw new Error(errorText(text, p.errors[0]));
  return Array.from({ length: count }, (_, i) => renderTemplate(p, i, count));
}

/**
 * Swaps every call for a unique number so the body can go through a JSON/XML formatter: a bare integer is valid
 * both inside a string and as a value. `restore` puts the original expressions back into the formatted text.
 */
export function templateForFormat(text: string): { text: string; restore: (formatted: string) => string } {
  const { calls } = parseTemplate(text);
  const base = 9182736400000;
  let out = "", at = 0;
  calls.forEach((c, k) => {
    out += text.slice(at, c.start) + String(base + k);
    at = c.end;
  });
  out += text.slice(at);
  return {
    text: out,
    restore: (formatted) => calls.reduce((s, c, k) => s.split(String(base + k)).join(text.slice(c.start, c.end)), formatted),
  };
}
