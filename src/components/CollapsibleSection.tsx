import type { PropsWithChildren, ReactNode } from "react";

interface CollapsibleSectionProps extends PropsWithChildren {
  title: string;
  helper?: ReactNode;
  count?: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export const CollapsibleSection = ({
  title,
  helper,
  count,
  open,
  onToggle,
  children
}: CollapsibleSectionProps) => (
  <section className={`card stack collapsible-section ${open ? "is-open" : ""}`}>
    <button type="button" className="collapsible-section__toggle" onClick={onToggle}>
      <div className="collapsible-section__head">
        <div>
          <h2>{title}</h2>
          {helper ? <p>{helper}</p> : null}
        </div>
        <div className="collapsible-section__meta">
          {count !== undefined ? <span className="meta-chip">{count}</span> : null}
          <span className="meta-chip meta-chip--accent">{open ? "Weniger" : "Mehr"}</span>
        </div>
      </div>
    </button>
    {open ? <div className="stack">{children}</div> : null}
  </section>
);
