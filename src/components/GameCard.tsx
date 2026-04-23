import type { Game } from "../types/game";
import { createGameSummary } from "../utils/gameCalculations";
import { formatDateLabel, formatDuration } from "../utils/time";

interface GameCardProps {
  game: Game;
  onOpen: () => void;
}

export const GameCard = ({ game, onOpen }: GameCardProps) => {
  const summary = createGameSummary(game);

  return (
    <button type="button" className="game-card" onClick={onOpen}>
      <div className="game-card__head">
        <span className={`status-pill status-pill--${game.status}`}>{game.status}</span>
        <span>{formatDateLabel(game.scheduledDate, game.scheduledTime)}</span>
      </div>
      <div className="game-card__body">
        {summary.players.map((player) => (
          <div key={player.playerId} className="game-card__player">
            <div>
              <strong>{player.name}</strong>
              <span>{player.armyName}</span>
            </div>
            <strong>{player.totalScore}</strong>
          </div>
        ))}
      </div>
      <div className="game-card__foot">
        <span>{summary.roundCount} Runden</span>
        <span>{formatDuration(summary.totalDurationMs)}</span>
      </div>
    </button>
  );
};
