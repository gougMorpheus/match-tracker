import { useEffect, useRef, useState, useMemo, type CSSProperties } from "react";
import { TvScoreChart } from "./TvScoreChart";
import { TvEventFeed } from "./TvEventFeed";
import { useServerSecondTick } from "../utils/useServerSecondTick";
import { useGameStore } from "../store/GameStore";
import { getPlayerColors } from "../data/factionColors";
import { buildTvEventFeed, getDeficitInfo } from "../utils/tvDashboard";
import { getGameOutcome, getHeadToHead, getPlayerWinRate } from "../utils/headToHead";
import { createTvSnapshot, detectTvHighlights, type TvSnapshot, type TvHighlight } from "../utils/tvHighlights";
import { getNowIso, formatDuration } from "../utils/time";
import type { Game } from "../types/game";
import {
  getCurrentRoundNumber, getCurrentTurnNumber, getLatestTurn,
  getPlayerComparablePrimaryScore, getPlayerComparableSecondaryScore, getPlayerComparableTotalScore,
  getPlayerCommandPoints, getPlayerTurnDurationTotalMs, getSetupDurationMs, getTurnDurationMs,
  getPlayerRoundScoreTotal, getPlayerCurrentRoundCommandPointsGained, getPlayerCurrentRoundCommandPointsSpent,
  getGameDurationMs, getTimeoutDurationMs, isSetupRunning, isTimeoutActive, isTurnPaused
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
  const { games } = useGameStore();
  const [highlightQueue, setHighlightQueue] = useState<TvHighlight[]>([]);
  const snapshot = useRef<TvSnapshot | null>(null);
  const shown = useRef(new Set<string>());
  const trackedGame = useRef(game.id);
  useEffect(() => {
    // Anchor highlights to the synchronized phase timestamp. Display timers still
    // use the live server clock; network/render delays must not change thresholds.
    const round = getCurrentRoundNumber(game), turnNumber = getCurrentTurnNumber(game);
    const boundary = game.timeEvents.filter(e =>
      (game.status === "completed" && e.action === "game-end") ||
      (e.action === "round-start" && e.roundNumber === round) ||
      (e.action === "turn-start" && e.roundNumber === round && e.turnNumber === turnNumber)
    ).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))[0];
    const next = createTvSnapshot(game, game.endedAt ?? boundary?.createdAt ?? getNowIso());
    if (trackedGame.current !== game.id) {
      trackedGame.current = game.id;
      snapshot.current = null;
      shown.current.clear();
      setHighlightQueue([]);
    }
    if (!snapshot.current) { snapshot.current = next; return; }
    if (snapshot.current.phaseKey === next.phaseKey) return;
    const highlights = detectTvHighlights(snapshot.current, next, game).filter(h => !shown.current.has(h.id));
    highlights.forEach(h => shown.current.add(h.id));
    next.lastLeaderId = next.leaderId ?? snapshot.current.lastLeaderId;
    snapshot.current = next;
    if (highlights.length) setHighlightQueue(queue => [...queue, ...highlights]);
  }, [game]);
  const activeHighlight = highlightQueue[0];
  useEffect(() => {
    if (!activeHighlight) return;
    const timer = setTimeout(() => setHighlightQueue(queue => queue.slice(1)), 4000);
    return () => clearTimeout(timer);
  }, [activeHighlight]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreenError, setFullscreenError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completed = isGameCompletedForDisplay(game);
  const turn = getLatestTurn(game);
  const timeout = isTimeoutActive(game) && !completed;
  const running = !completed && (isSetupRunning(game) || Boolean(turn?.timing.startedAt && !turn.timing.endedAt && !isTurnPaused(turn)));
  const status = completed ? "Beendet" : timeout ? "Time-out" : running ? "Läuft" : game.startedAt ? "Pausiert" : "Bereit";
  const phase = completed ? "Spiel beendet" : turn ? `Runde ${getCurrentRoundNumber(game)} · Zug ${getCurrentTurnNumber(game)}` : "Aufstellung";
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
  const colors = getPlayerColors(game.players[0].army.name, game.players[1].army.name);
  const playerStyle = (i: number) => ({ "--player-color": colors[i] } as CSSProperties);
  const times = game.players.map(p => getPlayerTurnDurationTotalMs(game, p.id));
  const totalTime = times[0] + times[1];
  const averages = game.players.map((p, i) => {
    const count = game.rounds.flatMap(r => r.turns).filter(t => t.playerId === p.id && t.timing.startedAt).length;
    return count ? times[i] / count : 0;
  });
  const deficit = getDeficitInfo(game);
  const outcome = completed ? getGameOutcome(game) : null;
  const winner = game.players.find(p => p.id === outcome?.winnerId);
  const loser = game.players.find(p => p.id !== outcome?.winnerId);
  const winnerVp = winner ? getPlayerComparableTotalScore(game, winner.id) : null;
  const loserVp = loser ? getPlayerComparableTotalScore(game, loser.id) : null;
  const margin = winnerVp !== null && loserVp !== null ? winnerVp - loserVp : null;
  const conceded = game.finishReason === "player-1-conceded" || game.finishReason === "player-2-conceded";
  const result = outcome?.draw ? "Unentschieden" : winner
    ? `${winner.name} gewinnt${conceded ? " durch Aufgabe" : margin !== null && margin > 0 ? ` mit ${margin} VP Vorsprung` : ""}`
    : "Spiel beendet";
  const exclude = game.status === "completed" ? undefined : game.id;
  const record = getHeadToHead(games, game.players[0].name, game.players[1].name, exclude);
  const rates = game.players.map(p => getPlayerWinRate(games, p.name, exclude));
  const currentRound = getCurrentRoundNumber(game);
  const feed = useMemo(() => buildTvEventFeed(game), [game]);
  const latestNote = game.noteEvents.filter(e => e.note.trim()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
  const playerName = (id: string) => game.players.find(p => p.id === id)?.name ?? "–";
  const roundData = Array.from({ length: 5 }, (_, r) => game.players.map(p => ({
    primary: game.scoreDetailLevel === "full" ? getPlayerRoundScoreTotal(game, p.id, r + 1, "primary") : null,
    secondary: game.scoreDetailLevel === "full" ? getPlayerRoundScoreTotal(game, p.id, r + 1, "secondary") : null,
    total: getPlayerRoundScoreTotal(game, p.id, r + 1),
    cpGained: getPlayerCurrentRoundCommandPointsGained(game, p.id, r + 1),
    cpSpent: getPlayerCurrentRoundCommandPointsSpent(game, p.id, r + 1),
    duration: game.rounds.filter(round => round.roundNumber === r + 1).flatMap(round => round.turns)
      .filter(t => t.playerId === p.id).reduce((sum, t) => sum + getTurnDurationMs(t, game), 0)
  })));
  const chartRounds = Math.min(5, currentRound);
  const cumulative = game.players.map(p => roundData.map((_, r) => {
    const throughRound = { ...game, legacyScoreTotals: {}, scoreEvents: game.scoreEvents.filter(e => e.roundNumber !== undefined && e.roundNumber <= r + 1) };
    return { total: getPlayerComparableTotalScore(throughRound, p.id) ?? 0,
      primary: getPlayerComparablePrimaryScore(throughRound, p.id) ?? 0 };
  }));
  const chartAvailable = game.scoreDetailLevel === "full" || game.scoreEvents.some(e => e.scoreType === "legacy-total" && e.roundNumber !== undefined);
  const renderPlayer = (i: number) => {
    const p = game.players[i], active = !completed && game.currentPlayerId === p.id;
    return <section style={playerStyle(i)} className={`tv-panel tv-player${active ? " tv-player--active" : ""}`}>
      <div className="tv-player__identity"><div><h1 title={p.name}>{p.name}</h1><p title={p.army.name}>{p.army.name}</p></div>
        <span className="tv-chip">{active ? "Am Zug" : `Spieler ${i + 1}`}</span></div>
      <div className="tv-player__score">{getPlayerComparableTotalScore(game, p.id) ?? "–"}<span>VP</span></div>
      <div className="tv-player__details">
        <div><span>Primär</span><strong>{getPlayerComparablePrimaryScore(game, p.id) ?? "–"}</strong></div>
        <div><span>Sekundär</span><strong>{getPlayerComparableSecondaryScore(game, p.id) ?? "–"}</strong></div>
        <div><span>CP</span><strong>{getPlayerCommandPoints(game, p.id)}</strong></div>
        <div><span>Spielerzeit</span><strong className="tv-player__time">{clock(times[i])}</strong></div>
      </div>
    </section>;
  };
  return (
    <div ref={root} className={`tv-game${controlsVisible ? "" : " tv-game--idle"}`}
      onPointerMove={showControls} onPointerDown={showControls} onKeyDown={showControls}>
      <main className="tv-dashboard">
        {renderPlayer(0)}
        <section className="tv-panel tv-phase">
          <span className="tv-eyebrow">MATCH TRACKER · LIVE DASHBOARD</span>
          <h2 className="tv-phase__title">{phase}</h2><span className={`tv-chip${running && !timeout ? " tv-chip--running" : ""}`}>{status} · Nur ansehen</span>
          <div className="tv-phase__clock"><span>{timeout ? "Time-out" : turn ? completed ? "Letzte Zugzeit" : "Laufende Zugzeit" : "Aufstellungszeit"}</span><strong>{clock(phaseMs)}</strong></div>
          <div className="tv-deficit"><strong>{completed ? result : deficit.text}</strong>{!completed && deficit.perRound !== null && <span>≈ {deficit.perRound} VP pro verbleibender Runde nötig</span>}</div>
        </section>
        {renderPlayer(1)}
        <section className="tv-panel tv-chart">
          <h2>Punkteverlauf <span>kumulativ · VP</span></h2>
          <div className="tv-legend">{game.players.map((p, i) => <span key={p.id} style={playerStyle(i)}><i />{p.name}</span>)}<span>━ Gesamt · ▮ Primär / ▨ Sekundär</span></div>
          {chartAvailable ? <TvScoreChart colors={colors} rounds={roundData} totals={cumulative.map(row => row.map(v => v.total))}
            roundCount={chartRounds} detailed={game.scoreDetailLevel === "full"} /> : <p className="tv-empty">Keine rundenbezogenen VP vorhanden</p>}
        </section>
        <section className="tv-panel tv-rounds">
          <h2>Rundenübersicht <span>Primär / Sekundär · CP +/− · Zeit</span></h2>
          <div className="tv-rounds__table"><table><thead><tr><th>Runde</th>{game.players.map((p, i) => <th key={p.id} style={{ color: colors[i] }}>{p.name}</th>)}</tr></thead>
            <tbody>{roundData.map((row, r) => <tr key={r} className={currentRound === r + 1 ? "tv-round--current" : ""}><th>R{r + 1}</th>{row.map((v, i) => <td key={i}>
              {r < currentRound ? <><strong>{v.primary ?? "–"} / {v.secondary ?? "–"}</strong><span>+{v.cpGained}/−{v.cpSpent}</span><span>{formatDuration(v.duration)}</span></> : <span>–</span>}
            </td>)}</tr>)}</tbody>
          </table></div>
        </section>
        <section className="tv-panel tv-history">
          <h2>Direkter Vergleich</h2><div className="tv-history__score"><span style={{ color: colors[0] }}>{record.winsA}</span> : <span style={{ color: colors[1] }}>{record.winsB}</span></div>
          <p>{record.games} gewertete Spiele{record.draws > 0 ? ` · ${record.draws} Unentschieden` : ""}</p>
          <h3>Gesamt-Siegquote</h3><div className="tv-winrates">{game.players.map((p, i) => <div className="tv-winrate" key={p.id} style={playerStyle(i)}><span>{p.name}</span><strong>{rates[i].percent === null ? "–" : `${rates[i].percent} %`} <small>· {rates[i].games} Spiele</small></strong></div>)}</div>
        </section>
        <section className="tv-panel tv-bottom">
          <div className="tv-time"><h2>Zeit-Duell <span>verbrauchte Spielerzeit</span></h2>
            <div className="tv-time__labels">{game.players.map((p, i) => <strong key={p.id} style={{ color: colors[i] }}>{p.name} · {clock(times[i])}</strong>)}</div>
            <div className="tv-time__bar" role="img" aria-label={`${game.players[0].name}: ${clock(times[0])}; ${game.players[1].name}: ${clock(times[1])}`}>
              {game.players.map((p, i) => <span key={p.id} style={{ background: colors[i], width: `${totalTime ? times[i] / totalTime * 100 : 50}%` }} />)}
            </div><div className="tv-time__averages">{game.players.map((p, i) => <span key={p.id}>Ø {p.name}: <strong>{formatDuration(averages[i])} / Zug</strong></span>)}</div>
            <div className="tv-time__totals"><div><span>Gesamtspielzeit</span><strong>{clock(getGameDurationMs(game))}</strong></div>
              {turn && <div><span>{completed ? "Letzter Zug" : "Aktueller Zug"} · {playerName(turn.playerId)}</span><strong>{clock(getTurnDurationMs(turn, game))}</strong></div>}
            </div>
          </div>
          <div className="tv-mission"><h2>Missionskarte</h2><dl>
            <div><dt>Primärmission</dt><dd>{game.primaryMission.trim() || "–"}</dd></div>
            <div><dt>Aufstellung</dt><dd>{game.deployment.trim() || "–"}</dd></div>
            {game.gamePoints > 0 && <div><dt>Spielpunkte</dt><dd>{game.gamePoints} Punkte</dd></div>}
            {game.players.some(p => p.id === game.startingPlayerId) && <div><dt>Startspieler</dt><dd>{playerName(game.startingPlayerId)}</dd></div>}
            {game.players.some(p => p.id === game.defenderPlayerId) && <div><dt>Angreifer / Verteidiger</dt><dd>{game.players.find(p => p.id !== game.defenderPlayerId)?.name} / {playerName(game.defenderPlayerId)}</dd></div>}
            {game.players.filter(p => p.army.detachment.trim()).map(p => <div key={p.id}><dt>{p.name} · Detachment</dt><dd>{p.army.detachment}</dd></div>)}
          </dl>{latestNote && <p className="tv-mission__note" title={latestNote.note}>Notiz: {latestNote.note}</p>}</div>
        </section>
        <section className="tv-panel tv-events-panel"><h2>Letzte Ereignisse <span>neueste zuerst</span></h2>
          <TvEventFeed feed={feed} gameId={game.id} />
        </section>
      </main>
      <nav className="tv-game__controls" aria-label="TV-Anzeige" onFocus={showControls}>
        {fullscreenSupported ? <button type="button" onClick={() => void fullscreen()}>Vollbild</button> : null}
        <button type="button" onClick={() => void exit()}>TV-Modus verlassen</button>
        {fullscreenError ? <span role="status">Vollbild ist hier nicht verfügbar.</span> : null}
      </nav>
      {activeHighlight && <div key={activeHighlight.id} className="tv-highlight" role="status" data-kind={activeHighlight.kind}
        style={{ "--player-color": colors[Math.max(0, game.players.findIndex(p => p.id === activeHighlight.playerId))] } as CSSProperties}>
        <div className="tv-highlight__card"><span className="tv-eyebrow">BIG MOMENT</span><h2>{activeHighlight.title}</h2><p>{activeHighlight.subtitle}</p></div>
      </div>}
    </div>
  );
};
