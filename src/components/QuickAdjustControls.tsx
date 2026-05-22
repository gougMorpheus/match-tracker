import type { Player, ScoreType } from "../types/game";

interface QuickAdjustControlsProps {
  player: Player;
  currentCommandPoints: number;
  isSubmitting?: boolean;
  canSpendCommandPoints?: boolean;
  onCommandPointChange: (playerId: string, direction: "plus" | "minus", amount: number) => Promise<void>;
  onScoreChange: (
    playerId: string,
    scoreType: Exclude<ScoreType, "legacy-total">,
    direction: "plus" | "minus",
    amount: number
  ) => Promise<void>;
}

const SCORE_AMOUNT_OPTIONS = Array.from({ length: 20 }, (_, index) => index + 1);
const SCORE_SELECTS: { scoreType: Exclude<ScoreType, "legacy-total">; label: string }[] = [
  { scoreType: "primary", label: "Prim" },
  { scoreType: "secondary", label: "Sek" },
  { scoreType: "challenge", label: "Chal" }
];

export const QuickAdjustControls = ({
  player,
  currentCommandPoints,
  isSubmitting = false,
  canSpendCommandPoints = true,
  onCommandPointChange,
  onScoreChange
}: QuickAdjustControlsProps) => {
  return (
    <div className="quick-controls">
      <div className="quick-controls__row quick-controls__row--cp">
        <div className="quick-controls__actions quick-controls__actions--pair">
          <button
            type="button"
            className="mini-button mini-button--accent"
            disabled={isSubmitting}
            onClick={() => void onCommandPointChange(player.id, "plus", 1)}
          >
            1 CP earn (+)
          </button>
          <button
            type="button"
            className="mini-button"
            disabled={isSubmitting || !canSpendCommandPoints || currentCommandPoints <= 0}
            onClick={() => void onCommandPointChange(player.id, "minus", 1)}
          >
            1 CP spend (-)
          </button>
        </div>
      </div>

      <div className="quick-controls__row quick-controls__row--score">
        {SCORE_SELECTS.map(({ scoreType, label }) => (
          <select
            key={scoreType}
            className="step-input quick-controls__score-select"
            value=""
            disabled={isSubmitting}
            aria-label={`${label} Punkte gutschreiben`}
            onChange={(event) => {
              const amount = Number(event.target.value);
              if (amount > 0) {
                void onScoreChange(player.id, scoreType, "plus", amount);
              }
            }}
          >
            <option value="">{label}</option>
            {SCORE_AMOUNT_OPTIONS.map((amount) => (
              <option key={amount} value={amount}>
                +{amount}
              </option>
            ))}
          </select>
        ))}
      </div>
    </div>
  );
};
