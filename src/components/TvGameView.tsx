import { useEffect, useRef, useState } from "react";
import { useServerSecondTick } from "../utils/useServerSecondTick";
import type { Game } from "../types/game";
import {
  getCurrentRoundNumber, getCurrentTurnNumber, getLatestTurn,
  getPlayerComparablePrimaryScore, getPlayerComparableSecondaryScore, getPlayerComparableTotalScore,
  getPlayerCommandPoints, getPlayerTurnDurationTotalMs, getSetupDurationMs, getTurnDurationMs,
  getTimeoutDurationMs, isSetupRunning, isTimeoutActive, isTurnPaused
} from "../utils/gameCalculations";
import { isGameCompletedForDisplay } from "../utils/gameAccessMode";

interface WakeLock { release: () => Promise<void>; released: boolean }
type WakeNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullscreenDocument = Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element };
const clock = (ms: number): string => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
};

export const TvGameView = ({ game, onExit }: { game: Game; onExit: () => void }) => {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreenError, setFullscreenError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completed = isGameCompletedForDisplay(game);
  const turn = getLatestTurn(game);
  const timeout = isTimeoutActive(game) && !completed;
  const running = !completed && (isSetupRunning(game) || Boolean(turn?.timing.startedAt && !turn.timing.endedAt && !isTurnPaused(turn)));
  const status = completed ? "Beendet" : timeout ? "Time-out" : running ? "Laeuft" : game.startedAt ? "Pausiert" : "Bereit";
  const phase = turn ? `Runde ${getCurrentRoundNumber(game)} · Zug ${getCurrentTurnNumber(game)}` : "Aufstellung";
  const phaseMs = timeout ? getTimeoutDurationMs(game) : turn ? getTurnDurationMs(turn, game) : getSetupDurationMs(game);
  const fullscreenSupported = typeof document !== "undefined" && Boolean(
    document.documentElement.requestFullscreen || (document.documentElement as FullscreenElement).webkitRequestFullscreen
  );
  const showControls = () => {
    setControlsVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setControlsVisible(false), 3500);
  };
  useEffect(() => {
    showControls();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, []);
  useServerSecondTick(!completed);
  useEffect(() => {
    let disposed = false;
    let acquiring = false;
    let lock: WakeLock | null = null;
    const acquire = async () => {
      if (disposed || document.hidden || acquiring || (lock && !lock.released)) return;
      acquiring = true;
      try {
        const next = await (navigator as WakeNavigator).wakeLock?.request("screen");
        if (next) {
          if (disposed || document.hidden) await next.release();
          else lock = next;
        }
      } catch { /* Unsupported, denied or low battery: display still works. */ }
      finally { acquiring = false; }
    };
    const visibility = () => {
      if (!document.hidden) void acquire();
      else { const old = lock; lock = null; void old?.release().catch(() => undefined); }
    };
    void acquire();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      void lock?.release().catch(() => undefined);
    };
  }, []);
  const fullscreen = async () => {
    try {
      const doc = document as FullscreenDocument;
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else doc.webkitExitFullscreen?.();
      } else {
        const element = root.current as FullscreenElement | null;
        if (element?.requestFullscreen) await element.requestFullscreen();
        else element?.webkitRequestFullscreen?.();
      }
      setFullscreenError(false);
    } catch { setFullscreenError(true); }
  };
  const exit = async () => {
    const doc = document as FullscreenDocument;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else if (doc.webkitFullscreenElement) doc.webkitExitFullscreen?.();
    } catch { /* Exit TV mode even when fullscreen cannot be exited. */ }
    onExit();
  };
  return (
    <div ref={root} className={`tv-game${controlsVisible ? "" : " tv-game--idle"}`}
      onPointerMove={showControls} onPointerDown={showControls} onKeyDown={showControls}>
      <header className="tv-game__header">
        <strong>{phase}</strong><span>{status} · Nur ansehen</span>
      </header>
      <main className="tv-game__players">
        {game.players.map((player) => {
          const active = !completed && game.currentPlayerId === player.id;
          return <section key={player.id} className={`tv-player${active ? " tv-player--active" : ""}`}>
            <div className="tv-player__active">{active ? "Aktiver Spieler" : "Spieler"}</div>
            <h1>{player.name}</h1><p className="tv-player__army">{player.army.name}</p>
            <div className="tv-player__score">{getPlayerComparableTotalScore(game, player.id) ?? "–"}<span>VP</span></div>
            <div className="tv-player__details">
              <span>Primaer <strong>{getPlayerComparablePrimaryScore(game, player.id) ?? "–"}</strong></span>
              <span>Sekundaer <strong>{getPlayerComparableSecondaryScore(game, player.id) ?? "–"}</strong></span>
              <span>CP <strong>{getPlayerCommandPoints(game, player.id)}</strong></span>
            </div>
            <div className="tv-player__timer"><span>Spielerzeit</span><strong>{clock(getPlayerTurnDurationTotalMs(game, player.id))}</strong></div>
          </section>;
        })}
      </main>
      <footer className="tv-game__footer">
        <div className="tv-game__phase"><span>{timeout ? "Time-out" : turn ? "Zugzeit" : "Aufstellungszeit"}</span><strong>{clock(phaseMs)}</strong></div>
        <div>{game.primaryMission ? <p>Primaermission: {game.primaryMission}</p> : null}
          {game.deployment ? <p>Aufstellung: {game.deployment}</p> : null}</div>
      </footer>
      <nav className="tv-game__controls" aria-label="TV-Anzeige" onFocus={showControls}>
        {fullscreenSupported ? <button type="button" onClick={() => void fullscreen()}>Vollbild</button> : null}
        <button type="button" onClick={() => void exit()}>TV-Modus verlassen</button>
        {fullscreenError ? <span role="status">Vollbild ist hier nicht verfuegbar.</span> : null}
      </nav>
    </div>
  );
};
