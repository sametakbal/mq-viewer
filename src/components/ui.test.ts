import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent, MouseEvent } from "react";
import { press } from "./ui";

const key = (el: HTMLElement, k: string, target: EventTarget = el) => {
  const e = { key: k, target, currentTarget: el, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  return e as unknown as KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
};

describe("press", () => {
  it("makes an element a focusable button by default", () => {
    const onClick = vi.fn();
    const p = press(onClick);
    expect(p).toMatchObject({ role: "button", tabIndex: 0, onClick });
    expect(press(onClick, "option", false)).toMatchObject({ role: "option", tabIndex: -1 });
  });

  it("clicks on Enter and Space, and keeps the key from reaching page shortcuts", () => {
    const el = document.createElement("div");
    const clicked = vi.fn();
    el.addEventListener("click", clicked);
    const { onKeyDown } = press(vi.fn());
    for (const k of ["Enter", " "]) {
      const e = key(el, k);
      onKeyDown(e);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(e.stopPropagation).toHaveBeenCalled();
    }
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it("ignores other keys and keys from inner elements", () => {
    const el = document.createElement("div");
    const clicked = vi.fn();
    el.addEventListener("click", clicked);
    const { onKeyDown } = press(vi.fn());
    const other = key(el, "a");
    onKeyDown(other);
    const inner = key(el, "Enter", document.createElement("input"));
    onKeyDown(inner);
    expect(clicked).not.toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(inner.stopPropagation).not.toHaveBeenCalled();
  });

  it("does not stay focused after a mouse click", () => {
    const el = document.createElement("div");
    el.tabIndex = 0;
    document.body.appendChild(el);
    const { onMouseUp } = press(vi.fn());
    el.focus();
    expect(document.activeElement).toBe(el);
    onMouseUp({ currentTarget: el } as unknown as MouseEvent<HTMLElement>);
    expect(document.activeElement).toBe(document.body);

    // Focus elsewhere is left alone.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    onMouseUp({ currentTarget: el } as unknown as MouseEvent<HTMLElement>);
    expect(document.activeElement).toBe(input);
    el.remove();
    input.remove();
  });
});
