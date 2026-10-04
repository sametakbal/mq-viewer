import { Component, type ReactNode } from "react";

/** Keeps a crash in one part of the UI from blanking the whole window. */
export default class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong in this view</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "pre-wrap" }}>{this.state.error.message}</div>
          <div>
            <button className="btn" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>Dismiss</button>
          </div>
        </div>
      </div>
    );
  }
}
