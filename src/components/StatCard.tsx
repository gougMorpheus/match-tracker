interface StatCardProps {
  label: string;
  value: string | number;
  helper?: string;
}

export const StatCard = ({ label, value, helper }: StatCardProps) => (
  <article className="stat-card">
    <span className="stat-card__label">{label}</span>
    <strong className="stat-card__value">{value}</strong>
    {helper ? <span className="stat-card__helper">{helper}</span> : null}
  </article>
);
