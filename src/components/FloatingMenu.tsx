import { useEffect, useRef, useState } from "react";

export interface FloatingMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface FloatingMenuSection {
  label: string;
  items: FloatingMenuItem[];
}

interface FloatingMenuProps {
  sections: FloatingMenuSection[];
  fixed?: boolean;
  ariaLabel?: string;
}

export const FloatingMenu = ({
  sections,
  fixed = false,
  ariaLabel = "Navigation"
}: FloatingMenuProps) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  return (
    <div ref={menuRef} className={`floating-menu ${fixed ? "floating-menu--fixed" : ""}`}>
      <button
        type="button"
        className="ghost-button compact-button floating-menu__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="floating-menu__burger" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      {open ? (
        <div className="floating-menu__panel">
          {sections.map((section) => (
            <div key={section.label} className="floating-menu__section">
              <p className="floating-menu__section-label">{section.label}</p>
              <div className="floating-menu__section-items">
                {section.items.map((item) => (
                  <button
                    key={`${section.label}-${item.label}`}
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
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
