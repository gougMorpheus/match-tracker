import type { PropsWithChildren, ReactNode } from "react";
import { useGameStore } from "../store/GameStore";

const formatSyncStamp = (iso: string): string =>
  new Intl.DateTimeFormat("de-DE", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(iso));

interface LayoutProps extends PropsWithChildren {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  stickyHeader?: boolean;
  headerClassName?: string;
}

export const Layout = ({
  title,
  subtitle,
  actions,
  footer,
  onBack,
  stickyHeader = false,
  headerClassName,
  children
}: LayoutProps) => {
  const { syncStatus, lastSyncAt, pendingSyncCount, retrySync } = useGameStore();
  const syncLabel = (() => {
    if (syncStatus === "syncing") {
      return "Sync laeuft";
    }
    if (syncStatus === "offline") {
      return "Offline";
    }
    if (syncStatus === "pending") {
      return `${pendingSyncCount} ungesynct`;
    }
    if (syncStatus === "error") {
      return "Sync Fehler";
    }
    return lastSyncAt ? `Sync ${formatSyncStamp(lastSyncAt)}` : "Noch kein Sync";
  })();

  return (
    <div className={`app-shell ${stickyHeader ? "app-shell--sticky-header" : ""}`}>
      <header className={`app-header ${headerClassName ?? ""}`.trim()}>
        <div className="header-content">
          <div className="header-topline">
            {onBack ? (
              <button type="button" className="back-button" onClick={onBack}>
                Zurueck
              </button>
            ) : null}
            <p className="eyebrow">40K Match-Tracker</p>
            <button
              type="button"
              className={`sync-indicator sync-indicator--${syncStatus}`}
              onClick={() => void retrySync()}
              title="Sync erneut versuchen"
            >
              {syncLabel}
            </button>
          </div>
          <div className="header-title-row">
            <h1>{title}</h1>
            {actions ? <div className="header-actions">{actions}</div> : null}
          </div>
          {subtitle ? <div className="subtitle">{subtitle}</div> : null}
        </div>
      </header>
      <main className="app-main">{children}</main>
      {footer ? <footer className="app-footer">{footer}</footer> : null}
    </div>
  );
};
