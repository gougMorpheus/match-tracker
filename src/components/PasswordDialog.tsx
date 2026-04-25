interface PasswordDialogProps {
  title: string;
  confirmLabel: string;
  value: string;
  error?: string;
  hint?: string;
  confirmTone?: "primary" | "danger";
  disabled?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export const PasswordDialog = ({
  title,
  confirmLabel,
  value,
  error,
  hint,
  confirmTone = "primary",
  disabled = false,
  onChange,
  onClose,
  onConfirm
}: PasswordDialogProps) => (
  <div className="modal-backdrop">
    <div className="modal-card">
      <div className="stack">
        <div className="list-row">
          <div>
            <h2>{title}</h2>
            <p className="muted-copy">Passwort erforderlich</p>
          </div>
          <button type="button" className="ghost-button compact-button" onClick={onClose}>
            Schliessen
          </button>
        </div>
        <label className="field">
          <span>Passwort</span>
          <input type="password" value={value} disabled={disabled} autoFocus onChange={(event) => onChange(event.target.value)} />
        </label>
        {error ? <p className="muted-copy">{error}</p> : null}
        {hint ? <p className="muted-copy">{hint}</p> : null}
        <div className="button-row button-row--compact">
          <button
            type="button"
            className={`${confirmTone === "danger" ? "danger-button" : "primary-button"} compact-button`}
            disabled={disabled || !value}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="button" className="ghost-button compact-button" disabled={disabled} onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  </div>
);
