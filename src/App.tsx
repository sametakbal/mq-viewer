import { useEffect, useState } from "react";
import { activeTabOf, connOf, useApp } from "./state";
import { setWindowTitle } from "./lib/rpc";
import { ENV_COLOR, SWATCHES } from "./lib/format";
import { importConnectionsFromFile } from "./lib/transfer";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import StatusBar from "./components/StatusBar";
import Toast from "./components/Toast";
import BrowseView from "./components/BrowseView";
import QueuesView from "./components/QueuesView";
import WelcomeView from "./components/WelcomeView";
import ErrorView from "./components/ErrorView";
import DetailPanel from "./components/DetailPanel";
import ConnectionDrawer from "./components/dialogs/ConnectionDrawer";
import PutDialog from "./components/dialogs/PutDialog";
import PurgeDialog from "./components/dialogs/PurgeDialog";
import DeleteDialog from "./components/dialogs/DeleteDialog";
import SettingsDialog from "./components/dialogs/SettingsDialog";
import CommandPalette from "./components/dialogs/CommandPalette";
import ErrorBoundary from "./components/ErrorBoundary";

function useResolvedTheme() {
  const theme = useApp((s) => s.settings.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export default function App() {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const overlay = useApp((s) => s.overlay);
  const setOverlay = useApp((s) => s.setOverlay);
  const tab = useApp(activeTabOf);
  const hasConnections = useApp((s) => s.connections.length > 0);
  const conn = useApp((s) => connOf(s, tab?.connId ?? s.focusConn));
  const status = useApp((s) => (tab ? s.status[tab.connId] : undefined));
  const browse = useApp((s) => (tab ? s.browse[tab.id] : undefined));
  const theme = useResolvedTheme();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const base = "mq-viewer";
    if (!conn) void setWindowTitle(base);
    else void setWindowTitle(`${base} — ${conn.name} · ${tab?.queue ?? conn.qmgr}`);
  }, [conn, tab?.queue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" && useApp.getState().overlay) {
        setOverlay(null);
        return;
      }
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setOverlay({ kind: "palette" });
      } else if (k === "n") {
        e.preventDefault();
        setOverlay({ kind: "connection" });
      } else if (k === "o") {
        e.preventDefault();
        void importConnectionsFromFile();
      } else if (k === ",") {
        e.preventDefault();
        setOverlay({ kind: "settings" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOverlay]);

  if (!ready) return <div className="app" data-mq-theme={theme} />;

  const stripe = !conn ? "transparent" : conn.env === "PROD" ? ENV_COLOR.PROD : SWATCHES[conn.color] ?? "transparent";
  // A tab whose connection failed shows the error card instead of its content.
  const connError = tab && status?.state === "error" && status.error && (tab.kind === "queues" || !browse?.messages.length);
  const showDetail = tab?.kind === "browse" && browse && !browse.detailClosed && !browse.error && browse.selected;

  let content;
  if (!hasConnections) content = <WelcomeView />;
  else if (!tab) content = <NoTab />;
  else if (connError) content = <ErrorView connId={tab.connId} error={status!.error!} retryable />;
  else if (tab.kind === "queues") content = <QueuesView tab={tab} />;
  else content = <BrowseView tab={tab} />;

  return (
    <div className="app" data-mq-theme={theme}>
      <div style={{ height: 3, flex: "none", background: stripe }} />
      <TopBar />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
          {hasConnections && <Tabs />}
          <ErrorBoundary key={tab?.id ?? "none"}>{content}</ErrorBoundary>
        </main>
        {showDetail && <ErrorBoundary key={browse?.selected ?? ""}><DetailPanel tab={tab!} /></ErrorBoundary>}
      </div>
      <StatusBar />

      {overlay && <div className="scrim" role="presentation" onClick={() => setOverlay(null)} />}
      <ErrorBoundary key={overlay?.kind ?? "none"} onReset={() => setOverlay(null)}>
      {overlay?.kind === "connection" && <ConnectionDrawer key={overlay.connId ?? "new"} connId={overlay.connId} />}
      {overlay?.kind === "put" && <PutDialog key={overlay.connId + overlay.queue} overlay={overlay} />}
      {overlay?.kind === "purge" && <PurgeDialog overlay={overlay} />}
      {overlay?.kind === "delete" && <DeleteDialog overlay={overlay} />}
      {overlay?.kind === "settings" && <SettingsDialog />}
      {overlay?.kind === "palette" && <CommandPalette />}
      </ErrorBoundary>
      <Toast />
    </div>
  );
}

function NoTab() {
  const focus = useApp((s) => connOf(s, s.focusConn));
  const openQueues = useApp((s) => s.openQueues);
  const setOverlay = useApp((s) => s.setOverlay);
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 460, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--raised)", border: "1px solid var(--line)", display: "grid", placeItems: "center", fontSize: 28, color: "var(--muted)" }}>
          <i className="ph-light ph-hard-drives" />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>Open a queue manager</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", textWrap: "pretty" }}>
          Pick a connection in the sidebar, or search queues across connected queue managers.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {focus && (
            <button className="btn primary" onClick={() => openQueues(focus.id)}>
              <i className="ph-light ph-plugs-connected" />Open {focus.name}
            </button>
          )}
          <button className="btn" onClick={() => setOverlay({ kind: "palette" })}>
            <i className="ph-light ph-magnifying-glass" />Search
            <span className="kbd" style={{ color: "var(--faint)" }}>Ctrl K</span>
          </button>
        </div>
      </div>
    </div>
  );
}
