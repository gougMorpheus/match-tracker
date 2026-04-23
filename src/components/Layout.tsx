import type { PropsWithChildren, ReactNode } from "react";

interface LayoutProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
}

export const Layout = ({ title, subtitle, actions, footer, onBack, children }: LayoutProps) => (
  <div className="app-shell">
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
        <h1>{title}</h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
    <main className="app-main">{children}</main>
    {footer ? <footer className="app-footer">{footer}</footer> : null}
  </div>
);
