import { useEffect, useState, type KeyboardEvent } from "react";
import { focusNextFormField } from "../utils/formKeys";

interface SelectOrCreateFieldProps {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  required?: boolean;
  selectPlaceholder: string;
  inputPlaceholder: string;
  createButtonLabel?: string;
  createButtonTitle?: string;
  onChange: (value: string) => void;
  onSelectOption?: (value: string) => void;
}

export const SelectOrCreateField = ({
  label,
  value,
  options,
  disabled = false,
  required = false,
  selectPlaceholder,
  inputPlaceholder,
  createButtonLabel = "+",
  createButtonTitle,
  onChange,
  onSelectOption
}: SelectOrCreateFieldProps) => {
  const matchesOption = options.includes(value);
  const [isCustomMode, setIsCustomMode] = useState(() => Boolean(value) && !matchesOption);

  // Enter im Eingabefeld übernimmt den Namen und springt zum nächsten Feld, statt das Formular abzuschicken.
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const trimmed = event.currentTarget.value.trim();
    if (trimmed !== value) onChange(trimmed);
    if (trimmed && options.includes(trimmed)) {
      setIsCustomMode(false);
      onSelectOption?.(trimmed);
    }
    focusNextFormField(event.currentTarget);
  };

  useEffect(() => {
    if (value && !options.includes(value)) {
      setIsCustomMode(true);
    }
  }, [options, value]);

  return (
    <label className="field">
      <span>{label}</span>
      {options.length ? (
        <div className="choice-field">
          <div className="choice-field__controls">
            <select
              value={matchesOption && !isCustomMode ? value : ""}
              disabled={disabled}
              required={required && !isCustomMode}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (!nextValue) {
                  onChange("");
                  return;
                }

                setIsCustomMode(false);
                onChange(nextValue);
                onSelectOption?.(nextValue);
              }}
            >
              <option value="">{selectPlaceholder}</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`ghost-button compact-button choice-field__toggle ${isCustomMode ? "is-active" : ""}`}
              disabled={disabled}
              aria-label={`${label}: neue Eingabe`}
              title={createButtonTitle ?? `${label}: neu eingeben`}
              onClick={() => {
                setIsCustomMode(true);
                if (matchesOption) {
                  onChange("");
                }
              }}
            >
              {createButtonLabel}
            </button>
          </div>
          {isCustomMode ? (
            <input
              value={matchesOption ? "" : value}
              disabled={disabled}
              required={required}
              placeholder={inputPlaceholder}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleInputKeyDown}
              enterKeyHint="next"
            />
          ) : null}
        </div>
      ) : (
        <input
          value={value}
          disabled={disabled}
          required={required}
          placeholder={inputPlaceholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          enterKeyHint="next"
        />
      )}
    </label>
  );
};
