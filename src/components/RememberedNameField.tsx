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
    {options.length ? (
      <div className="remembered-name-picker">
        <span className="remembered-name-picker__label">Gespeicherte Namen</span>
        <select
          value={options.includes(value) ? value : ""}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value) {
              onChange(event.target.value);
            }
          }}
        >
          <option value="">Name auswaehlen</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    ) : null}
    <input
      required
      value={value}
      disabled={disabled}
      placeholder="Name eingeben"
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
);
