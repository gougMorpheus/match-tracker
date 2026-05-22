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
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, select, textarea, [data-no-section-toggle='true']")) {
        return;
      }
      onToggle();
    }}
  >
    <div className="collapsible-section__head">
      <div className="collapsible-section__title-row">
        {count !== undefined ? <span className="meta-chip">{count}</span> : null}
        <div>
          <h2>{title}</h2>
          {helper ? <p>{helper}</p> : null}
        </div>
      </div>
      <div className="collapsible-section__meta">
        {actions ? (
          <span className="collapsible-section__actions" data-no-section-toggle="true">
            {actions}
          </span>
        ) : null}
        <button
          type="button"
          className="meta-chip meta-chip--accent collapsible-section__toggle"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {open ? "Weniger" : "Mehr"}
        </button>
      </div>
    </div>
    {open ? (
      <div className="stack">
        {children}
      </div>
    ) : null}
  </section>
);
