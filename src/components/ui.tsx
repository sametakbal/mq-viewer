import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { Env } from "../lib/types";
import type { ConnState } from "../state";

export const Icon = ({ name, size, color, style }: { name: string; size?: number; color?: string; style?: CSSProperties }) => (
  <i className={`ph-light ${name}`} style={{ fontSize: size, color, ...style }} />
);

export const Spinner = ({ size = 14 }: { size?: number }) => (
  <span style={{ display: "flex", color: "var(--accent)", fontSize: size }}>
    <i className="ph-light ph-circle-notch spin" />
  </span>
);

export const EnvBadge = ({ env }: { env: Env }) => {
  const bg = env === "PROD" ? "var(--prod)" : env === "TEST" ? "var(--warn)" : "var(--ok)";
  return <span className="env-badge" style={{ background: bg, color: env === "PROD" ? "#fff" : "var(--accent-ink)" }}>{env}</span>;
};

/** Status dot: filled when connected/connecting/error, hollow when disconnected. */
export const StatusDot = ({ state, size = 8 }: { state: ConnState | undefined; size?: number }) => {
  const c = state === "connected" ? "var(--ok)" : state === "connecting" ? "var(--warn)" : state === "error" ? "var(--err)" : null;
  return (
    <span
      style={{
        width: size, height: size, borderRadius: "50%", flex: "none", boxSizing: "border-box",
        background: c ?? "transparent", border: `1.5px solid ${c ?? "var(--faint)"}`,
        animation: state === "connecting" ? "mqpulse 1.2s infinite" : undefined,
      }}
    />
  );
};

/**
 * Props that let a clickable element that is not a <button> be used from the keyboard: it can be reached with
 * Tab (or, with `inTabOrder` false, only by the arrow-key handling that already exists), and Enter or Space
 * click it. A mouse click does not leave it focused, so Enter/Space keep going to the page as before.
 */
export function press<E extends HTMLElement = HTMLElement>(onClick: (e: MouseEvent<E>) => void, role = "button", inTabOrder = true) {
  return {
    role,
    tabIndex: inTabOrder ? 0 : -1,
    onClick,
    onKeyDown: (e: KeyboardEvent<E>) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.click();
    },
    onMouseUp: (e: MouseEvent<E>) => {
      if (document.activeElement === e.currentTarget) e.currentTarget.blur();
    },
  };
}

export const Switch = ({ on, onChange, large }: { on: boolean; onChange: (v: boolean) => void; large?: boolean }) => (
  <span className={`switch${on ? " on" : ""}${large ? " lg" : ""}`} aria-checked={on} {...press((e) => { e.stopPropagation(); onChange(!on); }, "switch")} />
);

export const Checkbox = ({ on, mixed, large }: { on: boolean; mixed?: boolean; large?: boolean }) => (
  <span className={`checkbox${on ? " on" : mixed ? " mixed" : ""}${large ? " lg" : ""}`} />
);

export function Segmented<T extends string | number>({ options, value, onChange, mono, fill }: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  mono?: boolean;
  fill?: boolean;
}) {
  return (
    <div className={`segmented${mono ? " mono" : ""}${fill ? " fill" : ""}`}>
      {options.map((o) => (
        <span
          key={String(o.value)}
          className={`${o.value === value ? "on" : ""}${o.disabled ? " disabled" : ""}`}
          {...press(() => !o.disabled && onChange(o.value))}
          aria-pressed={o.value === value}
          aria-disabled={o.disabled}
        >
          {o.label}
        </span>
      ))}
    </div>
  );
}

export const Field = ({ label, children, style }: { label: ReactNode; children: ReactNode; style?: CSSProperties }) => (
  <label className="field" style={style}>
    <span className="label">{label}</span>
    {children}
  </label>
);

export function Empty({ icon, title, children, actions }: { icon: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", padding: 24 }}>
      <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--raised)", border: "1px solid var(--line)", display: "grid", placeItems: "center", fontSize: 28, color: "var(--muted)" }}>
        <Icon name={icon} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{title}</div>
      {children && <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 380, textWrap: "pretty" }}>{children}</div>}
      {actions && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>{actions}</div>}
    </div>
  );
}
