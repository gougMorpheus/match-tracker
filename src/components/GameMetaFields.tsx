import type { CreateGameInput } from "../types/game";
import { SelectOrCreateField } from "./SelectOrCreateField";

interface GameMetaFieldsProps {
  value: CreateGameInput;
  deploymentOptions: string[];
  primaryMissionOptions: string[];
  disabled?: boolean;
  onChange: <K extends keyof CreateGameInput>(key: K, nextValue: CreateGameInput[K]) => void;
}

export const GameMetaFields = ({
  value,
  deploymentOptions,
  primaryMissionOptions,
  disabled = false,
  onChange
}: GameMetaFieldsProps) => (
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

    <div className="field">
      <span>Defender</span>
      <div className="segmented-control">
        <button
          type="button"
          className={value.defenderSlot === "player1" ? "is-selected" : ""}
          onClick={() => onChange("defenderSlot", "player1")}
          disabled={disabled}
        >
          Spieler 1
        </button>
        <button
          type="button"
          className={value.defenderSlot === "player2" ? "is-selected" : ""}
          onClick={() => onChange("defenderSlot", "player2")}
          disabled={disabled}
        >
          Spieler 2
        </button>
      </div>
    </div>

    <div className="field">
      <span>Startspieler</span>
      <div className="segmented-control">
        <button
          type="button"
          className={value.startingSlot === "player1" ? "is-selected" : ""}
          onClick={() => onChange("startingSlot", "player1")}
          disabled={disabled}
        >
          Spieler 1
        </button>
        <button
          type="button"
          className={value.startingSlot === "player2" ? "is-selected" : ""}
          onClick={() => onChange("startingSlot", "player2")}
          disabled={disabled}
        >
          Spieler 2
        </button>
      </div>
    </div>
  </section>
);
