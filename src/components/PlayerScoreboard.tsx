import type { Game, Player } from "../types/game";
import type { ReactNode } from "react";
import {
  getPlayerCommandPoints,
  getPlayerCommandPointsGained,
  getPlayerCurrentRoundPrimaryTotal,
  getPlayerCurrentRoundSecondaryTotal,
  getPlayerCurrentRoundTotalScore,
  getPlayerCommandPointsSpent,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTurnDurationTotalMs,
  getPlayerTotalScore
} from "../utils/gameCalculations";
import { formatDuration } from "../utils/time";

interface PlayerScoreboardProps {
  game: Game;
  player: Player;
  emphasized?: boolean;
  defender?: boolean;
  controls?: ReactNode;
  noteAction?: ReactNode;
}

export const PlayerScoreboard = ({
  game,
  player,
  emphasized = false,
  defender = false,
  controls,
  noteAction
}: PlayerScoreboardProps) => {
  const primary = getPlayerPrimaryTotal(game, player.id);
  const secondary = getPlayerSecondaryTotal(game, player.id);
  const total = getPlayerTotalScore(game, player.id);
  const currentRoundPrimary = getPlayerCurrentRoundPrimaryTotal(game, player.id);
  const currentRoundSecondary = getPlayerCurrentRoundSecondaryTotal(game, player.id);
  const currentRoundTotal = getPlayerCurrentRoundTotalScore(game, player.id);
  const cp = getPlayerCommandPoints(game, player.id);
  const cpGained = getPlayerCommandPointsGained(game, player.id);
  const cpSpent = getPlayerCommandPointsSpent(game, player.id);
  const activeDuration = getPlayerTurnDurationTotalMs(game, player.id);

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
        <div className="scoreboard-stat scoreboard-stat--accent scoreboard-stat--total">
          <div className="scoreboard-stat__top">
            <span>Ges</span>
            <strong>{total}</strong>
          </div>
          <span className="scoreboard-stat__meta">Runde +{currentRoundTotal}</span>
        </div>
        <div className="scoreboard-stat scoreboard-stat--cp">
          <div className="scoreboard-stat__top">
            <span>CP</span>
            <strong>{cp}</strong>
          </div>
          <span className="scoreboard-stat__meta">
            +{cpGained} / -{cpSpent}
          </span>
        </div>
        <div className="scoreboard-stat scoreboard-stat--time">
          <div className="scoreboard-stat__top">
            <span>Zeit</span>
            <strong>{formatDuration(activeDuration)}</strong>
          </div>
          <span className="scoreboard-stat__meta">Gesamt aktiv</span>
        </div>
      </div>
      {controls ? <div className="scoreboard__controls">{controls}</div> : null}
    </article>
  );
};
