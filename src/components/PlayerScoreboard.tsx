import type { Game, Player } from "../types/game";
import {
  getPlayerCommandPoints,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTotalScore
} from "../utils/gameCalculations";

interface PlayerScoreboardProps {
  game: Game;
  player: Player;
  emphasized?: boolean;
  defender?: boolean;
}

export const PlayerScoreboard = ({
  game,
  player,
  emphasized = false,
  defender = false
}: PlayerScoreboardProps) => {
  const primary = getPlayerPrimaryTotal(game, player.id);
  const secondary = getPlayerSecondaryTotal(game, player.id);
  const total = getPlayerTotalScore(game, player.id);
  const cp = getPlayerCommandPoints(game, player.id);

  return (
    <article className={`scoreboard ${emphasized ? "is-emphasized" : ""}`}>
      <div className="scoreboard__head">
        <div>
          <h2>{player.name}</h2>
          <p>
            {player.army.name} | {player.army.maxPoints} Pkt.
          </p>
        </div>
        <div className="scoreboard__meta">
          {defender ? <span className="meta-chip">Defender</span> : null}
          {emphasized ? <span className="meta-chip meta-chip--accent">Aktiv</span> : null}
        </div>
      </div>
      <div className="scoreboard__grid">
        <div>
          <span>CP</span>
          <strong>{cp}</strong>
        </div>
        <div>
          <span>Primary</span>
          <strong>{primary}</strong>
        </div>
        <div>
          <span>Secondary</span>
          <strong>{secondary}</strong>
        </div>
        <div>
          <span>Gesamt</span>
          <strong>{total}</strong>
        </div>
      </div>
    </article>
  );
};
