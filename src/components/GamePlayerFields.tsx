import { SelectOrCreateField } from "./SelectOrCreateField";
import { ARMY_OPTIONS } from "../data/armies";

interface GamePlayerFieldsProps {
  title: string;
  nameValue: string;
  armyValue: string;
  detachmentValue: string;
  playerOptions: string[];
  detachmentOptions: string[];
  disabled?: boolean;
  onNameChange: (value: string) => void;
  onSelectRememberedName: (value: string) => void;
  onArmyChange: (value: string) => void;
  onDetachmentChange: (value: string) => void;
}

export const GamePlayerFields = ({
  title,
  nameValue,
  armyValue,
  detachmentValue,
  playerOptions,
  detachmentOptions,
  disabled = false,
  onNameChange,
  onSelectRememberedName,
  onArmyChange,
  onDetachmentChange
}: GamePlayerFieldsProps) => (
  <section className="card stack">
    <h2>{title}</h2>
    <SelectOrCreateField
      label="Name"
      value={nameValue}
      options={playerOptions}
      required
      disabled={disabled}
      selectPlaceholder="Spieler waehlen"
      inputPlaceholder="Neuen Namen eingeben"
      onChange={onNameChange}
      onSelectOption={onSelectRememberedName}
    />
    <label className="field">
      <span>Armee</span>
      <select required value={armyValue} onChange={(event) => onArmyChange(event.target.value)} disabled={disabled}>
        <option value="">Armee waehlen</option>
        {ARMY_OPTIONS.map((army) => (
          <option key={army} value={army}>
            {army}
          </option>
        ))}
      </select>
    </label>
    <SelectOrCreateField
      label="Detachment (optional)"
      value={detachmentValue}
      options={detachmentOptions}
      disabled={disabled}
      selectPlaceholder="Detachment waehlen"
      inputPlaceholder="Neues Detachment eingeben"
      onChange={onDetachmentChange}
    />
  </section>
);
