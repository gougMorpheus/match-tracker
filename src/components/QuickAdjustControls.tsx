import { useState } from "react";
import type { Player } from "../types/game";

interface QuickAdjustControlsProps {
  player: Player;
  currentCommandPoints: number;
  currentPrimary: number;
  currentSecondary: number;
  isSubmitting?: boolean;
  canSpendCommandPoints?: boolean;
  onCommandPointChange: (playerId: string, direction: "plus" | "minus", amount: number) => Promise<void>;
  onScoreChange: (
    playerId: string,
    scoreType: "primary" | "secondary",
    direction: "plus" | "minus",
    amount: number
  ) => Promise<void>;
  onAddNote: (playerId: string) => void;
}

const CP_AMOUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SCORE_AMOUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const QuickAdjustControls = ({
  player,
  currentCommandPoints,
  currentPrimary,
  currentSecondary,
  isSubmitting = false,
  canSpendCommandPoints = true,
  onCommandPointChange,
  onScoreChange,
  onAddNote
}: QuickAdjustControlsProps) => {
  const [cpAmount, setCpAmount] = useState(1);
  const [primaryAmount, setPrimaryAmount] = useState(1);
  const [secondaryAmount, setSecondaryAmount] = useState(1);

  return (
    <div className="quick-controls">
      <div className="quick-controls__row">
        <span>CP</span>
        <div className="quick-controls__actions">
          <button
            type="button"
            className="mini-button"
            disabled={isSubmitting || !canSpendCommandPoints || currentCommandPoints <= 0}
            onClick={() => void onCommandPointChange(player.id, "minus", cpAmount)}
          >
            Spend {cpAmount}
          </button>
          <select
            className="step-input"
            value={cpAmount}
            disabled={isSubmitting}
            onChange={(event) => setCpAmount(Number(event.target.value))}
          >
            {CP_AMOUNT_OPTIONS.map((amount) => (
              <option key={amount} value={amount}>
                {amount}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mini-button mini-button--accent"
            disabled={isSubmitting}
            onClick={() => void onCommandPointChange(player.id, "plus", cpAmount)}
          >
            Earn {cpAmount}
          </button>
        </div>
      </div>

      <div className="quick-controls__row">
        <span>Primary</span>
        <div className="quick-controls__actions">
          <button
            type="button"
            className="mini-button"
            disabled={isSubmitting || currentPrimary <= 0}
            onClick={() => void onScoreChange(player.id, "primary", "minus", primaryAmount)}
          >
            -{primaryAmount}
          </button>
          <select
            className="step-input"
            value={primaryAmount}
            disabled={isSubmitting}
            onChange={(event) => setPrimaryAmount(Number(event.target.value))}
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
            onClick={() => void onScoreChange(player.id, "primary", "plus", primaryAmount)}
          >
            +{primaryAmount}
          </button>
        </div>
      </div>

      <div className="quick-controls__row">
        <span>Secondary</span>
        <div className="quick-controls__actions">
          <button
            type="button"
            className="mini-button"
            disabled={isSubmitting || currentSecondary <= 0}
            onClick={() => void onScoreChange(player.id, "secondary", "minus", secondaryAmount)}
          >
            -{secondaryAmount}
          </button>
          <select
            className="step-input"
            value={secondaryAmount}
            disabled={isSubmitting}
            onChange={(event) => setSecondaryAmount(Number(event.target.value))}
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
            onClick={() => void onScoreChange(player.id, "secondary", "plus", secondaryAmount)}
          >
            +{secondaryAmount}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="mini-button mini-button--accent"
        disabled={isSubmitting}
        onClick={() => onAddNote(player.id)}
      >
        Notiz hinzufuegen
      </button>
    </div>
  );
};
