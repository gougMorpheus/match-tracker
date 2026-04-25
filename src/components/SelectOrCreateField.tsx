import { useEffect, useState } from "react";

interface SelectOrCreateFieldProps {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  required?: boolean;
  selectPlaceholder: string;
  inputPlaceholder: string;
  createButtonLabel?: string;
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
  onChange,
  onSelectOption
}: SelectOrCreateFieldProps) => {
  const matchesOption = options.includes(value);
  const [isCustomMode, setIsCustomMode] = useState(() => Boolean(value) && !matchesOption);

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
        />
      )}
    </label>
  );
};
