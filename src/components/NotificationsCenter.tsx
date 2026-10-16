import { useEffect, useMemo, useState } from "react";
import { useGameStore } from "../store/GameStore";
import {
  OPEN_NOTIFICATIONS_EVENT,
  updatePushFollowSettings,
  usePushFollowSettings
} from "../pwa/pushFollowStore";
import { applyAutoFollow, getFollowedGameIds, setAutoFollowNew, setGameFollowed } from "../utils/pushFollow";
import { detectPushEnvironment, getPushHint, getPushStatus } from "../utils/pushSupport";
import { isGameCompletedForDisplay } from "../utils/gameAccessMode";
import type { Game } from "../types/game";

const gameLabel = (game: Game) => `${game.players[0].name} vs. ${game.players[1].name}`;

// Uebersicht "Notifications" (unter Optionen) und Hinweis nach "Folgen". Stufe a: nur lokal, kein Abo.
export const NotificationsCenter = () => {
  const { games } = useGameStore();
  const settings = usePushFollowSettings();
  const [mode, setMode] = useState<"overview" | "hint" | null>(null);
  const [env, setEnv] = useState(detectPushEnvironment);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setEnv(detectPushEnvironment());
      setMode(((event as CustomEvent).detail?.mode as "overview" | "hint") ?? "overview");
    };
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!mode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMode(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [mode]);

  // Neuen Spielen automatisch folgen (nur Spiele, die nach dem Einschalten angelegt wurden).
  useEffect(() => {
    if (settings.autoFollowNew) updatePushFollowSettings((current) => applyAutoFollow(current, games));
  }, [games, settings.autoFollowNew]);

  const status = getPushStatus(env);
  const hint = getPushHint(status, env.isIos, mode === "hint" ? "hint" : "overview");
  const followed = useMemo(() => {
    const byId = new Map(games.map((game) => [game.id, game]));
    return getFollowedGameIds(settings).map((id) => ({ id, game: byId.get(id), entry: settings.follows[id] }));
  }, [games, settings]);

  if (!mode) return null;

  const requestPermission = async () => {
    try { await Notification.requestPermission(); } catch { /* ignoriert */ }
    setEnv(detectPushEnvironment());
  };

  const hintBox = (
    <div className={`push-hint push-hint--${status}`} role="status">
      {hint.title ? <strong>{hint.title}</strong> : null}
      {hint.lines.map((line) => <p key={line}>{line}</p>)}
      {hint.canRequestPermission ? (
        <button type="button" className="primary-button compact-button" onClick={() => void requestPermission()}>
          Notifications erlauben
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="modal-backdrop notifications-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setMode(null); }}>
      <div className="modal-card notifications-card" role="dialog" aria-modal="true" aria-label={mode === "hint" ? "Hinweis Notifications" : "Notifications"}>
        <div className="stack">
          <div className="list-row">
            <h2>{mode === "hint" ? "Spiel gefolgt" : "Notifications"}</h2>
            <button type="button" className="ghost-button compact-button" onClick={() => setMode(null)}>Schließen</button>
          </div>
          {mode === "hint" ? (
            <>
                            {hintBox}
              <div className="button-row button-row--compact">
                <button type="button" className="secondary-button compact-button" onClick={() => setMode("overview")}>Übersicht öffnen</button>
              </div>
            </>
          ) : (
            <>
              {hintBox}
              <label className="notifications-switch">
                <input
                  type="checkbox"
                  checked={settings.autoFollowNew}
                  onChange={(event) => { const on = event.target.checked; updatePushFollowSettings((current) => setAutoFollowNew(current, on)); }}
                />
                <span>Neuen Spielen automatisch folgen</span>
              </label>
              <div className="stack notifications-list">
                <h3>Gefolgte Spiele ({followed.length})</h3>
                {followed.length ? followed.map(({ id, game, entry }) => (
                  <div key={id} className="notifications-row">
                    <div>
                      <strong>{game ? gameLabel(game) : "Spiel nicht verfügbar"}</strong>
                      <p className="muted-copy">
                        {game ? `${game.scheduledDate} · ${isGameCompletedForDisplay(game) ? "beendet" : "läuft"}` : id.slice(0, 8)}
                        {entry?.source === "auto" ? " · automatisch" : ""}
                      </p>
                    </div>
                    <div className="button-row button-row--compact">
                      {game ? (
                        <button type="button" className="ghost-button compact-button" onClick={() => { setMode(null); window.location.hash = `/game/${id}`; }}>Öffnen</button>
                      ) : null}
                      <button type="button" className="ghost-button compact-button" onClick={() => updatePushFollowSettings((current) => setGameFollowed(current, id, false))}>
                        Entfolgen
                      </button>
                    </div>
                  </div>
                )) : <p className="muted-copy">Noch keinem Spiel gefolgt. Im Spiel unter Optionen „Folgen“ wählen.</p>}
              </div>
              <p className="muted-copy notifications-device">Dieses Gerät: {settings.deviceId.slice(0, 8)}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
