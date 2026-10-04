import { useApp } from "../state";
import { importConnectionsFromFile } from "../lib/transfer";
import { Icon } from "./ui";

export default function WelcomeView() {
  const setOverlay = useApp((s) => s.setOverlay);
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 520, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
        <div style={{ width: 64, height: 64, borderRadius: 14, background: "var(--raised)", border: "1px solid var(--line)", display: "grid", placeItems: "center", fontSize: 30, color: "var(--accent)" }}>
          <Icon name="ph-plugs" />
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6 }}>Connect to your first queue manager</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, textWrap: "pretty" }}>
          Save a connection to browse queues, inspect messages without consuming them, and put test messages. Passwords stay in your OS keychain.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn primary lg" style={{ height: 34 }} onClick={() => setOverlay({ kind: "connection" })}><Icon name="ph-plus" />New connection</button>
          <button className="btn lg" style={{ height: 34 }} onClick={() => void importConnectionsFromFile()}><Icon name="ph-download-simple" />Import JSON config</button>
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8 }}>Ctrl N new connection · Ctrl O import</div>
      </div>
    </div>
  );
}
