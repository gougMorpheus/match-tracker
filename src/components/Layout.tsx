import type { PropsWithChildren, ReactNode } from "react";

interface LayoutProps extends PropsWithChildren {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  stickyHeader?: boolean;
}

export const Layout = ({
  title,
  subtitle,
  actions,
  footer,
  onBack,
  stickyHeader = false,
  children
}: LayoutProps) => (
  <div className={`app-shell ${stickyHeader ? "app-shell--sticky-header" : ""}`}>
    <header className="app-header">
      <div className="header-content">
        <div className="header-topline">
          {onBack ? (
            <button type="button" className="back-button" onClick={onBack}>
              Zurueck
            </button>
          ) : null}
          <p className="eyebrow">40K Match-Tracker</p>
        </div>
        <div className="header-title-row">
          <h1>{title}</h1>
          {actions ? <div className="header-actions">{actions}</div> : null}
        </div>
        {subtitle ? <div className="subtitle">{subtitle}</div> : null}
      </div>
    </header>
    <main className="app-main">{children}</main>
    {footer ? <footer className="app-footer">{footer}</footer> : null}
  </div>
);
