import type { ReactNode } from "react";

export interface NavigationItem {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}

interface NavigationProps {
  items: NavigationItem[];
}

export const Navigation = ({ items }: NavigationProps) => (
  <nav className="bottom-nav" aria-label="Navigation">
    {items.map((item) => (
      <button
        key={item.key}
        type="button"
        className={`bottom-nav__item ${item.active ? "is-active" : ""}`}
        onClick={item.onClick}
      >
        <span className="bottom-nav__icon">{item.icon}</span>
        <span>{item.label}</span>
      </button>
    ))}
  </nav>
);
