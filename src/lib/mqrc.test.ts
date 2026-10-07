import { describe, expect, it } from "vitest";
import { explain, logLine, short } from "./mqrc";

const err = (code: number, name: string, message = "msg", detail?: string) => ({ code, name, cc: 2, message, detail });

describe("explain", () => {
  it("uses the catalogue for known reason codes", () => {
    const e = explain(err(2035, "MQRC_NOT_AUTHORIZED"));
    expect(e).toMatchObject({ code: 2035, name: "MQRC_NOT_AUTHORIZED", title: "Not authorized", edit: "credentials" });
    expect(e.causes.length).toBeGreaterThan(0);
  });

  it("explains a missing sidecar", () => {
    for (const name of ["SIDECAR_UNAVAILABLE", "SIDECAR_EXITED"]) {
      const e = explain(err(0, name, "java died"));
      expect(e).toMatchObject({ code: 0, name, title: "MQ engine is not running", desc: "java died", icon: "ph-plug" });
    }
  });

  it("builds a readable title for unknown reason codes", () => {
    expect(explain(err(2999, "MQRC_SOMETHING_ODD")).title).toBe("Something odd");
    expect(explain(err(0, "UNEXPECTED")).title).toBe("Request failed");
    expect(explain(err(0, "UNEXPECTED")).causes).toEqual([]);
  });
});

describe("logLine / short", () => {
  it("joins the message and the root cause", () => {
    expect(logLine(err(2059, "X", "refused", "java.net.ConnectException"))).toBe("refused — java.net.ConnectException");
    expect(logLine(err(2059, "X", "refused"))).toBe("refused");
  });

  it("shows code and name without the MQRC_ prefix", () => {
    expect(short(err(2085, "MQRC_UNKNOWN_OBJECT_NAME"))).toBe("2085 UNKNOWN_OBJECT_NAME");
    expect(short(err(0, "UNEXPECTED"))).toBe("UNEXPECTED");
  });
});
