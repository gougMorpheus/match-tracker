import { useState } from "react";
import type { Player } from "../types/game";

interface QuickAdjustControlsProps {
  player: Player;
  isSubmitting?: boolean;
  onCommandPointChange: (playerId: string, direction: "plus" | "minus", amount: number) => Promise<void>;
  onScoreChange: (
    playerId: string,
    scoreType: "primary" | "secondary",
    direction: "plus" | "minus",
    amount: number
  ) => Promise<void>;
  onAddNote: (playerId: string) => void;
}

export const QuickAdjustControls = ({
  player,
  isSubmitting = false,
  onCommandPointChange,
  onScoreChange,
  onAddNote
}: QuickAdjustControlsProps) => {
  const [cpAmount, setCpAmount] = useState(0);
  const [primaryAmount, setPrimaryAmount] = useState(0);
  const [secondaryAmount, setSecondaryAmount] = useState(0);

  return (
    <div className="quick-controls">
      <div className="quick-controls__row">
        <span>CP Earn / Spend</span>
        <div className="quick-controls__actions">
          <button
            type="button"
            className="mini-button"
            disabled={isSubmitting}
            onClick={() => void onCommandPointChange(player.id, "minus", cpAmount)}
          >
            Spend {cpAmount}
          </button>
          <input
            className="step-input"
            type="number"
            min={0}
            inputMode="numeric"
            value={cpAmount}
            disabled={isSubmitting}
            onChange={(event) => setCpAmount(Math.max(0, Number(event.target.value) || 0))}
          />
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
            disabled={isSubmitting}
            onClick={() => void onScoreChange(player.id, "primary", "minus", primaryAmount)}
          >
            -{primaryAmount}
          </button>
          <input
            className="step-input"
            type="number"
            min={0}
            inputMode="numeric"
            value={primaryAmount}
            disabled={isSubmitting}
            onChange={(event) => setPrimaryAmount(Math.max(0, Number(event.target.value) || 0))}
          />
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
            disabled={isSubmitting}
            onClick={() => void onScoreChange(player.id, "secondary", "minus", secondaryAmount)}
          >
            -{secondaryAmount}
          </button>
          <input
            className="step-input"
            type="number"
            min={0}
            inputMode="numeric"
            value={secondaryAmount}
            disabled={isSubmitting}
            onChange={(event) => setSecondaryAmount(Math.max(0, Number(event.target.value) || 0))}
          />
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
