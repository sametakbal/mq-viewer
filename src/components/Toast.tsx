import { useApp } from "../state";
import { Icon } from "./ui";

export default function Toast() {
  const toast = useApp((s) => s.toast);
  const close = useApp((s) => s.closeToast);
  if (!toast) return null;
  const ok = toast.tone === "ok";
  return (
    <div className="toast" role="status">
      <Icon name={ok ? "ph-check-circle" : "ph-warning-octagon"} size={20} color={ok ? "var(--ok)" : "var(--err)"} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{toast.title}</div>
        {toast.sub && <div className="mono ellipsis" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }} title={toast.sub}>{toast.sub}</div>}
        {toast.actions && (
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12 }}>
            {toast.actions.map((a) => (
              <span key={a.label} style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => { a.run(); close(); }}>{a.label}</span>
            ))}
          </div>
        )}
      </div>
      <i onClick={close} className="ph-light ph-x" style={{ fontSize: 13, color: "var(--faint)", cursor: "pointer" }} />
    </div>
  );
}
