import { useEffect } from "react";
import { useGameStore } from "../store/GameStore";

// Kurzer Hinweis bei Sync-Konflikten (409) und bei veralteter App-Version.
export const SyncNotices = () => {
  const { syncNotice, appUpdateNotice, dismissSyncNotice } = useGameStore();

  useEffect(() => {
    if (!syncNotice) return;
    const timer = window.setTimeout(dismissSyncNotice, 8000);
    return () => window.clearTimeout(timer);
  }, [dismissSyncNotice, syncNotice]);

  if (!syncNotice && !appUpdateNotice) return null;
  return (
    <div className="sync-notices" role="status" aria-live="polite">
      {syncNotice ? (
        <div className="sync-notice sync-notice--conflict" data-testid="sync-conflict-notice">
          <span>{syncNotice}</span>
          <button type="button" className="secondary-button compact-button" onClick={dismissSyncNotice}>OK</button>
        </div>
      ) : null}
      {appUpdateNotice ? (
        <div className="sync-notice sync-notice--update" data-testid="app-update-notice">
          <span>{appUpdateNotice}</span>
          <button type="button" className="primary-button compact-button" onClick={() => window.location.reload()}>
            Neu laden
          </button>
        </div>
      ) : null}
    </div>
  );
};
