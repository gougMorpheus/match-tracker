interface RememberedNameFieldProps {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

export const RememberedNameField = ({
  label,
  value,
  options,
  disabled = false,
  onChange
}: RememberedNameFieldProps) => (
  <label className="field">
    <span>{label}</span>
    <input
      required
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
    {options.length ? (
      <div className="chip-row">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`chip-button ${option === value ? "is-selected" : ""}`}
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    ) : null}
  </label>
);
