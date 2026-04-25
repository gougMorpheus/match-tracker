import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  helper?: string;
  chart?: ReactNode;
  tone?: "default" | "score" | "time" | "success" | "warning";
}

export const StatCard = ({ label, value, helper, chart, tone = "default" }: StatCardProps) => (
  <article className={`stat-card stat-card--${tone}`}>
    <span className="stat-card__label">{label}</span>
    <strong className="stat-card__value">{value}</strong>
    {helper ? <span className="stat-card__helper">{helper}</span> : null}
    {chart ? <div className="stat-card__chart">{chart}</div> : null}
  </article>
);
