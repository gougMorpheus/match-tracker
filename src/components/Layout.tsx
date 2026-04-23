import type { PropsWithChildren, ReactNode } from "react";

interface LayoutProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
}

export const Layout = ({ title, subtitle, actions, footer, children }: LayoutProps) => (
  <div className="app-shell">
    <header className="app-header">
      <div>
        <p className="eyebrow">Match Tracker</p>
        <h1>{title}</h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
    <main className="app-main">{children}</main>
    {footer ? <footer className="app-footer">{footer}</footer> : null}
  </div>
);
