import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface FloatingMenuItem {
  label: string;
  detail?: string;
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
  className?: string;
}

export const FloatingMenu = ({
  sections,
  fixed = false,
  ariaLabel = "Navigation",
  className = ""
}: FloatingMenuProps) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Fixe Menues werden per Portal an <body> (bzw. das Vollbild-Element) gehaengt, damit
  // Vorfahren mit backdrop-filter/transform (Spiel-Header, TV-Ansicht) weder Position
  // noch Schriftgroesse veraendern. So sieht das Menue auf allen Seiten gleich aus.
  const [portalTarget, setPortalTarget] = useState<Element | null>(() =>
    fixed && typeof document !== "undefined" ? getMenuPortalTarget() : null
  );

  useEffect(() => {
    if (!fixed) return;
    const update = () => setPortalTarget(getMenuPortalTarget());
    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, [fixed]);

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

    // Escape schliesst zuerst das offene Menue (vor Dialogen darunter).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const menu = (
    <div ref={menuRef} className={`floating-menu ${fixed ? "floating-menu--fixed" : ""} ${className}`.trim()}>
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
                    <span className="floating-menu__item-label">{item.label}</span>
                    {item.detail ? <span className="floating-menu__item-detail">{item.detail}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
  return fixed && portalTarget ? createPortal(menu, portalTarget) : menu;
};

const getMenuPortalTarget = (): Element => {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  const fullscreenElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  return fullscreenElement && fullscreenElement !== document.documentElement ? fullscreenElement : document.body;
};
