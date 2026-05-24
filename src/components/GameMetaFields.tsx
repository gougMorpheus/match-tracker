import type { CreateGameInput } from "../types/game";
import { SelectOrCreateField } from "./SelectOrCreateField";

interface GameMetaFieldsProps {
  value: CreateGameInput;
  deploymentOptions: string[];
  primaryMissionOptions: string[];
  autoCommandPointOn?: boolean;
  defenderError?: string;
  disabled?: boolean;
  onChange: <K extends keyof CreateGameInput>(key: K, nextValue: CreateGameInput[K]) => void;
  onToggleAutoCommandPoint?: (nextValue: boolean) => void;
}

export const GameMetaFields = ({
  value,
  deploymentOptions,
  primaryMissionOptions,
  autoCommandPointOn,
  defenderError,
  disabled = false,
  onChange,
  onToggleAutoCommandPoint
}: GameMetaFieldsProps) => {
  const playerOneLabel = value.playerOneName.trim() || "Spieler 1";
  const playerTwoLabel = value.playerTwoName.trim() || "Spieler 2";

  return (
  <section className="card stack">
    <h2>Spiel</h2>
    <label className="field">
      <span>Spielpunkte</span>
      <input
        required
        type="number"
        min={0}
        inputMode="numeric"
        value={value.gamePoints}
        onChange={(event) => onChange("gamePoints", Number(event.target.value) || 0)}
        disabled={disabled}
      />
    </label>
    <div className="two-column-grid game-scheduling-grid">
      <label className="field">
        <span>Datum</span>
        <input
          required
          type="date"
          value={value.scheduledDate}
          onChange={(event) => onChange("scheduledDate", event.target.value)}
          disabled={disabled}
        />
      </label>
      <label className="field">
        <span>Uhrzeit</span>
        <input
          required
          type="time"
          value={value.scheduledTime}
          onChange={(event) => onChange("scheduledTime", event.target.value)}
          disabled={disabled}
        />
      </label>
    </div>
    <SelectOrCreateField
      label="Aufstellung (optional)"
      value={value.deployment}
      options={deploymentOptions}
      disabled={disabled}
      selectPlaceholder="Aufstellung waehlen"
      inputPlaceholder="Neue Aufstellung eingeben"
      onChange={(nextValue) => onChange("deployment", nextValue)}
    />
    <SelectOrCreateField
      label="Primaermission (optional)"
      value={value.primaryMission}
      options={primaryMissionOptions}
      disabled={disabled}
      selectPlaceholder="Primaermission waehlen"
      inputPlaceholder="Neue Primaermission eingeben"
      onChange={(nextValue) => onChange("primaryMission", nextValue)}
    />

    {typeof autoCommandPointOn === "boolean" && onToggleAutoCommandPoint ? (
      <div className="field">
        <span>Auto CP</span>
        <button
          type="button"
          className={`toggle-button ${autoCommandPointOn ? "is-active" : ""}`}
          disabled={disabled}
          onClick={() => onToggleAutoCommandPoint(!autoCommandPointOn)}
        >
          {autoCommandPointOn ? "An" : "Aus"}
        </button>
      </div>
    ) : null}

    <div className="field">
      <span>Defender</span>
      <select
        value={value.defenderSlot}
        required
        aria-invalid={Boolean(defenderError)}
        disabled={disabled}
        onChange={(event) => onChange("defenderSlot", event.target.value as CreateGameInput["defenderSlot"])}
      >
        <option value="">Bitte auswaehlen</option>
        <option value="player1">{playerOneLabel}</option>
        <option value="player2">{playerTwoLabel}</option>
      </select>
      {defenderError ? <p className="field__error">{defenderError}</p> : null}
    </div>

    <div className="field">
      <span>Startspieler</span>
      <select
        value={value.startingSlot}
        disabled={disabled}
        onChange={(event) => onChange("startingSlot", event.target.value as CreateGameInput["startingSlot"])}
      >
        <option value="">Bitte auswaehlen</option>
        <option value="player1">{playerOneLabel}</option>
        <option value="player2">{playerTwoLabel}</option>
      </select>
    </div>
  </section>
  );
};
