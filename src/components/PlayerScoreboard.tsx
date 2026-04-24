import type { Game, Player } from "../types/game";
import type { ReactNode } from "react";
import {
  getPlayerCommandPoints,
  getPlayerCommandPointsGained,
  getPlayerCommandPointsSpent,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTotalScore
} from "../utils/gameCalculations";

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
  const cp = getPlayerCommandPoints(game, player.id);
  const cpGained = getPlayerCommandPointsGained(game, player.id);
  const cpSpent = getPlayerCommandPointsSpent(game, player.id);

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
      <div className="scoreboard__grid scoreboard__grid--compact">
        <div>
          <span>CP</span>
          <strong>{cp}</strong>
          <p>+{cpGained} / -{cpSpent}</p>
        </div>
        <div>
          <span>Prim</span>
          <strong>{primary}</strong>
        </div>
        <div>
          <span>Sek</span>
          <strong>{secondary}</strong>
        </div>
        <div>
          <span>Ges</span>
          <strong>{total}</strong>
        </div>
      </div>
      {controls ? <div className="scoreboard__controls">{controls}</div> : null}
    </article>
  );
};
