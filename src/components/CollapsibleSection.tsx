import type { PropsWithChildren, ReactNode } from "react";

interface CollapsibleSectionProps extends PropsWithChildren {
  title: string;
  helper?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export const CollapsibleSection = ({
  title,
  helper,
  count,
  actions,
  open,
  onToggle,
  children
}: CollapsibleSectionProps) => (
  <section
    className={`card stack collapsible-section ${open ? "is-open" : ""}`}
    onClick={(event) => {
      if (event.target === event.currentTarget) {
        onToggle();
      }
    }}
  >
    <button
      type="button"
      className="collapsible-section__toggle"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <div className="collapsible-section__head">
        <div>
          <h2>{title}</h2>
          {helper ? <p>{helper}</p> : null}
        </div>
        <div className="collapsible-section__meta">
          {actions ? (
            <span className="collapsible-section__actions" onClick={(event) => event.stopPropagation()}>
              {actions}
            </span>
          ) : null}
          {count !== undefined ? <span className="meta-chip">{count}</span> : null}
          <span className="meta-chip meta-chip--accent">{open ? "Weniger" : "Mehr"}</span>
        </div>
      </div>
    </button>
    {open ? (
      <div className="stack" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    ) : null}
  </section>
);
