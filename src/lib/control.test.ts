import { describe, expect, it } from "vitest";
import {
  controlName, controlPicture, controlSummary, fromEditorText, INSERTABLE, isControlPicture, segments, toEditorText,
  withControlPictures,
} from "./control";

describe("names and pictures", () => {
  it("names C0 controls and DEL only", () => {
    expect(controlName(1)).toBe("SOH");
    expect(controlName(31)).toBe("US");
    expect(controlName(127)).toBe("DEL");
    expect(controlName(65)).toBeNull();
  });

  it("maps to the Control Pictures block", () => {
    expect(controlPicture(2)).toBe("␂");
    expect(controlPicture(127)).toBe("␡");
    expect(withControlPictures("a\x01b\x7f")).toBe("a␁b␡");
  });

  it("recognises pictures", () => {
    expect(isControlPicture("␃")).toBe(true);
    expect(isControlPicture("␡")).toBe(true);
    expect(isControlPicture("x")).toBe(false);
    expect(isControlPicture("␃␃")).toBe(false);
  });

  it("offers every control except LF and TAB for insertion", () => {
    const codes = INSERTABLE.map((x) => x.code);
    expect(codes).not.toContain(9);
    expect(codes).not.toContain(10);
    expect(codes).toContain(127);
    expect(INSERTABLE[0]).toEqual({ code: 1, name: "SOH" });
  });
});

describe("segments", () => {
  it("splits text and controls and marks line breaks", () => {
    const s = segments("a\r\nb\rc\x01");
    expect(s).toEqual([
      { kind: "text", text: "a" },
      { kind: "ctl", name: "CR", code: 13, lineEnd: true, breakAfter: false },
      { kind: "ctl", name: "LF", code: 10, lineEnd: true, breakAfter: true },
      { kind: "text", text: "b" },
      { kind: "ctl", name: "CR", code: 13, lineEnd: true, breakAfter: true },
      { kind: "text", text: "c" },
      { kind: "ctl", name: "SOH", code: 1, lineEnd: false, breakAfter: false },
    ]);
  });
});

describe("controlSummary", () => {
  it("summarises line endings and counts", () => {
    expect(controlSummary("a\r\nb\r\n\x01\x01\x02")).toBe("CRLF · SOH×2 · STX");
    expect(controlSummary("a\nb")).toBe("LF");
    expect(controlSummary("a\rb")).toBe("CR");
    expect(controlSummary("a\r\nb\n")).toBe("mixed CRLF/LF");
    expect(controlSummary("plain")).toBe("no control characters");
  });
});

describe("editor form", () => {
  it("shows controls as pictures but keeps LF and TAB, one code unit each", () => {
    const body = "\x01H\x02{}\r\n\tx\x03\x7f\x00";
    const shown = toEditorText(body);
    expect(shown).toBe("␁H␂{}␍\n\tx␃␡␀");
    expect(shown).toHaveLength(body.length);
    expect(fromEditorText(shown)).toBe(body);
  });
});
