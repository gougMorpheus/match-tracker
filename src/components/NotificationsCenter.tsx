import { getTvModeHash } from "../utils/gameAccessMode";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "../store/GameStore";
import {
  OPEN_NOTIFICATIONS_EVENT,
  updatePushFollowSettings,
  usePushFollowSettings
} from "../pwa/pushFollowStore";
import { applyAutoFollow, getFollowedGameIds, getPushFollowSyncKey, pruneDeletedFollows, setAutoFollowNew, setGameFollowed } from "../utils/pushFollow";
import { subscribeAndSync, syncFollowsIfSubscribed } from "../pwa/pushSubscription";
import { detectPushEnvironment, getPushHint, getPushStatus } from "../utils/pushSupport";
import { isGameCompletedForDisplay } from "../utils/gameAccessMode";
import type { Game } from "../types/game";

const gameLabel = (game: Game) => `${game.players[0].name} vs. ${game.players[1].name}`;

// Uebersicht "Notifications" (unter Optionen) und Hinweis nach "Folgen".
// Stufe b: "Notifications erlauben" legt das echte Push-Abo an; Folgen/Auto-Follow werden per RPC abgeglichen.
export const NotificationsCenter = () => {
  const { games, lastSyncAt } = useGameStore();
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

  // Geloeschte Spiele verschwinden aus den gefolgten Spielen, sobald die Liste frisch vom Server geladen ist.
  useEffect(() => {
    if (lastSyncAt) updatePushFollowSettings((current) => pruneDeletedFollows(current, games.map((game) => game.id)));
  }, [games, lastSyncAt]);

  // Neuen Spielen automatisch folgen (nur Spiele, die nach dem Einschalten angelegt wurden).
  useEffect(() => {
    if (settings.autoFollowNew) updatePushFollowSettings((current) => applyAutoFollow(current, games));
  }, [games, settings.autoFollowNew]);

  // Push-Abo: Status der letzten Anmeldung (nur Anzeige).
  const [sync, setSync] = useState<{ state: "idle" | "working" | "ok" | "error"; message?: string }>({ state: "idle" });
  const latest = useRef(settings);
  latest.current = settings;
  const syncKey = getPushFollowSyncKey(settings);
  useEffect(() => {
    if (env.permission !== "granted") return;
    const timer = setTimeout(() => {
      void syncFollowsIfSubscribed(latest.current).then((ok) => setSync(ok ? { state: "ok" } : { state: "error", message: "Abgleich mit dem Server fehlgeschlagen. Bitte später erneut versuchen." }));
    }, 600);
    return () => clearTimeout(timer);
  }, [syncKey, env.permission]);

  const status = getPushStatus(env);
  const hint = getPushHint(status, env.isIos, mode === "hint" ? "hint" : "overview");
  const followed = useMemo(() => {
    const byId = new Map(games.map((game) => [game.id, game]));
    return getFollowedGameIds(settings).map((id) => ({ id, game: byId.get(id), entry: settings.follows[id] }));
  }, [games, settings]);

  if (!mode) return null;

  const connect = async () => {
    setSync({ state: "working" });
    const result = await subscribeAndSync(latest.current);
    setSync(result.ok ? { state: "ok" } : { state: "error", message: result.message });
  };
  const requestPermission = async () => {
    try { await Notification.requestPermission(); } catch { /* ignoriert */ }
    const next = detectPushEnvironment();
    setEnv(next);
    if (next.permission === "granted") await connect();
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
      {status === "granted" ? (
        <>
          {sync.state === "working" || sync.state === "idle" ? <p>Push wird eingerichtet …</p> : null}
          {sync.state === "ok" ? <p className="push-hint__ok">Push-Abo auf diesem Gerät ist aktiv.</p> : null}
          {sync.message && sync.state !== "ok" ? <p>{sync.message}</p> : null}
          <div className="button-row button-row--compact">
            {sync.state === "error" ? (
              <button type="button" className="primary-button compact-button" onClick={() => void connect()}>Erneut versuchen</button>
            ) : null}
          </div>
        </>
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
                        <button type="button" className="ghost-button compact-button" onClick={() => { setMode(null); window.location.hash = getTvModeHash(id); }}>Öffnen</button>
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
