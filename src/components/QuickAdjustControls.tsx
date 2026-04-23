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
  onSaveNote: (playerId: string, note: string) => Promise<void>;
}

export const QuickAdjustControls = ({
  player,
  isSubmitting = false,
  onCommandPointChange,
  onScoreChange,
  onSaveNote
}: QuickAdjustControlsProps) => {
  const [cpAmount, setCpAmount] = useState(1);
  const [primaryAmount, setPrimaryAmount] = useState(5);
  const [secondaryAmount, setSecondaryAmount] = useState(5);
  const [note, setNote] = useState("");

  return (
    <div className="quick-controls">
      <div className="quick-controls__row">
        <span>CP</span>
        <div className="quick-controls__actions">
          <button
            type="button"
            className="mini-button"
            disabled={isSubmitting}
            onClick={() => void onCommandPointChange(player.id, "minus", cpAmount)}
          >
            -{cpAmount}
          </button>
          <input
            className="step-input"
            type="number"
            min={1}
            inputMode="numeric"
            value={cpAmount}
            disabled={isSubmitting}
            onChange={(event) => setCpAmount(Math.max(1, Number(event.target.value) || 1))}
          />
          <button
            type="button"
            className="mini-button mini-button--accent"
            disabled={isSubmitting}
            onClick={() => void onCommandPointChange(player.id, "plus", cpAmount)}
          >
            +{cpAmount}
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
            min={1}
            inputMode="numeric"
            value={primaryAmount}
            disabled={isSubmitting}
            onChange={(event) => setPrimaryAmount(Math.max(1, Number(event.target.value) || 1))}
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
            min={1}
            inputMode="numeric"
            value={secondaryAmount}
            disabled={isSubmitting}
            onChange={(event) => setSecondaryAmount(Math.max(1, Number(event.target.value) || 1))}
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

      <div className="quick-controls__note">
        <textarea
          rows={2}
          placeholder={`${player.name}: Notiz`}
          value={note}
          disabled={isSubmitting}
          onChange={(event) => setNote(event.target.value)}
        />
        <button
          type="button"
          className="mini-button mini-button--accent"
          disabled={isSubmitting || !note.trim()}
          onClick={async () => {
            await onSaveNote(player.id, note);
            setNote("");
          }}
        >
          Notiz speichern
        </button>
      </div>
    </div>
  );
};
