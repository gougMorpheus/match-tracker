import { useState } from "react";
import type { Player } from "../types/game";

interface QuickAdjustControlsProps {
  player: Player;
  currentCommandPoints: number;
  isSubmitting?: boolean;
  canSpendCommandPoints?: boolean;
  onCommandPointChange: (playerId: string, direction: "plus" | "minus", amount: number) => Promise<void>;
  onScoreChange: (
    playerId: string,
    scoreType: "primary" | "secondary",
    direction: "plus" | "minus",
    amount: number
  ) => Promise<void>;
}

const SCORE_AMOUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const QuickAdjustControls = ({
  player,
  currentCommandPoints,
  isSubmitting = false,
  canSpendCommandPoints = true,
  onCommandPointChange,
  onScoreChange
}: QuickAdjustControlsProps) => {
  const [scoreAmount, setScoreAmount] = useState(1);

  return (
    <div className="quick-controls">
      <div className="quick-controls__row quick-controls__row--cp">
        <div className="quick-controls__actions quick-controls__actions--pair">
          <button
            type="button"
            className="mini-button"
            disabled={isSubmitting || !canSpendCommandPoints || currentCommandPoints <= 0}
            onClick={() => void onCommandPointChange(player.id, "minus", 1)}
          >
            1 CP spend
          </button>
          <button
            type="button"
            className="mini-button mini-button--accent"
            disabled={isSubmitting}
            onClick={() => void onCommandPointChange(player.id, "plus", 1)}
          >
            1 CP earn
          </button>
        </div>
      </div>

      <div className="quick-controls__row quick-controls__row--score">
        <button
          type="button"
          className="mini-button mini-button--accent"
          disabled={isSubmitting}
          onClick={() => void onScoreChange(player.id, "primary", "plus", scoreAmount)}
        >
          Prim +{scoreAmount}
        </button>
        <select
          className="step-input"
          value={scoreAmount}
          disabled={isSubmitting}
          onChange={(event) => setScoreAmount(Number(event.target.value))}
        >
          {SCORE_AMOUNT_OPTIONS.map((amount) => (
            <option key={amount} value={amount}>
              {amount}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="mini-button mini-button--accent"
          disabled={isSubmitting}
          onClick={() => void onScoreChange(player.id, "secondary", "plus", scoreAmount)}
        >
          Sek +{scoreAmount}
        </button>
      </div>
    </div>
  );
};
