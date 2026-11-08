import type { Game, Player } from "../types/game";
import type { ReactNode } from "react";
import {
  getActiveTurn,
  getPlayerCommandPoints,
  getPlayerCommandPointsGained,
  getPlayerChallengeTotal,
  getPlayerCurrentRoundChallengeTotal,
  getPlayerCurrentRoundPrimaryTotal,
  getPlayerCurrentRoundSecondaryTotal,
  getPlayerCurrentRoundTotalScore,
  getPlayerCurrentRoundCommandPointsGained,
  getPlayerCurrentRoundCommandPointsSpent,
  getPlayerCommandPointsSpent,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTurnDurationTotalMs,
  getPlayerTotalScore,
  getTurnDurationMs
} from "../utils/gameCalculations";
import { formatDuration } from "../utils/time";

interface PlayerScoreboardProps {
  game: Game;
  player: Player;
  roundNumber: number;
  emphasized?: boolean;
  defender?: boolean;
  controls?: ReactNode;
  noteAction?: ReactNode;
}

export const PlayerScoreboard = ({
  game,
  player,
  roundNumber,
  emphasized = false,
  defender = false,
  controls,
  noteAction
}: PlayerScoreboardProps) => {
  const primary = getPlayerPrimaryTotal(game, player.id);
  const secondary = getPlayerSecondaryTotal(game, player.id);
  const challenge = getPlayerChallengeTotal(game, player.id);
  const total = getPlayerTotalScore(game, player.id);
  const currentRoundPrimary = getPlayerCurrentRoundPrimaryTotal(game, player.id, roundNumber);
  const currentRoundSecondary = getPlayerCurrentRoundSecondaryTotal(game, player.id, roundNumber);
  const currentRoundChallenge = getPlayerCurrentRoundChallengeTotal(game, player.id, roundNumber);
  const currentRoundTotal = getPlayerCurrentRoundTotalScore(game, player.id, roundNumber);
  const currentRoundCpGained = getPlayerCurrentRoundCommandPointsGained(game, player.id, roundNumber);
  const currentRoundCpSpent = getPlayerCurrentRoundCommandPointsSpent(game, player.id, roundNumber);
  const cp = getPlayerCommandPoints(game, player.id);
  const cpGained = getPlayerCommandPointsGained(game, player.id);
  const cpSpent = getPlayerCommandPointsSpent(game, player.id);
  const activeDuration = getPlayerTurnDurationTotalMs(game, player.id);
  // Anzeige der schon berechneten Dauer des einen aktiven Zugs. Kein eigener Timer.
  const activeTurn = getActiveTurn(game);
  const currentTurnDurationMs =
    activeTurn?.playerId === player.id ? getTurnDurationMs(activeTurn, game) : 0;

  return (
    <article className={`scoreboard ${emphasized ? "is-emphasized" : ""}`}>
      <div className="scoreboard__head">
        <div>
          <h2>{player.name}</h2>
          <p>{player.army.name}</p>
        </div>
        <div className="scoreboard__meta">
          {noteAction}
          {defender ? <span className="meta-chip">Defender</span> : null}
          {emphasized ? <span className="meta-chip meta-chip--accent">Aktiv</span> : null}
        </div>
      </div>
      <div className="scoreboard__grid scoreboard__grid--compact scoreboard__grid--player">
        <div className="scoreboard-stat scoreboard-stat--primary">
          <div className="scoreboard-stat__top">
            <span>Prim</span>
            <strong>{primary}</strong>
          </div>
          <span className="scoreboard-stat__meta">Runde +{currentRoundPrimary}</span>
        </div>
        <div className="scoreboard-stat scoreboard-stat--secondary">
          <div className="scoreboard-stat__top">
            <span>Sek</span>
            <strong>{secondary}</strong>
          </div>
          <span className="scoreboard-stat__meta">Runde +{currentRoundSecondary}</span>
        </div>
        <div className="scoreboard-stat scoreboard-stat--challenge">
          <div className="scoreboard-stat__top">
            <span>Chal</span>
            <strong>{challenge}</strong>
          </div>
          <span className="scoreboard-stat__meta">Runde +{currentRoundChallenge}</span>
        </div>
        <div className="scoreboard-stat scoreboard-stat--accent scoreboard-stat--total">
          <span className="scoreboard-stat__kind">Gesamt</span>
          <strong className="scoreboard-stat__figure">{total}</strong>
          <span className="scoreboard-stat__meta">Runde +{currentRoundTotal}</span>
        </div>
        <div className="scoreboard-stat scoreboard-stat--cp">
          <div className="scoreboard-stat__top">
            <span className="scoreboard-stat__identity">
              <span className="scoreboard-stat__badge">CP</span>
              <span className="scoreboard-stat__kind">Konto</span>
            </span>
            <strong>{cp}</strong>
          </div>
          <span className="scoreboard-stat__meta">+{cpGained} / -{cpSpent}</span>
          <span className="scoreboard-stat__meta">
            Rd +{currentRoundCpGained} / -{currentRoundCpSpent}
          </span>
        </div>
        <div className="scoreboard-stat scoreboard-stat--time">
          <div className="scoreboard-stat__line">
            <span>Σ Zeit</span>
            <strong>{formatDuration(activeDuration)}</strong>
          </div>
          <div className="scoreboard-stat__line">
            <span>Zug</span>
            <strong>{formatDuration(currentTurnDurationMs)}</strong>
          </div>
        </div>
      </div>
      {controls ? <div className="scoreboard__controls">{controls}</div> : null}
    </article>
  );
};
