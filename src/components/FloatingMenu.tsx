import { useState } from "react";

export interface FloatingMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface FloatingMenuProps {
  label?: string;
  items: FloatingMenuItem[];
}

export const FloatingMenu = ({ label = "Menue", items }: FloatingMenuProps) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="floating-menu">
      <button
        type="button"
        className="ghost-button compact-button floating-menu__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? (
        <div className="floating-menu__panel">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`floating-menu__item ${item.danger ? "is-danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
