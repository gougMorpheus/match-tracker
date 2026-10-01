import { useId, useLayoutEffect, useRef, useState } from "react";
interface RoundScores { primary: number | null; secondary: number | null }
interface Props {
  colors: string[]; rounds: RoundScores[][]; totals: number[][]; roundCount: number; detailed: boolean;
}
// Match viewBox units to CSS pixels: axes keep the same readable TV font size,
// and the plot fills the available panel instead of letterboxing a fixed ratio.
export const TvScoreChart = ({ colors, rounds, totals, roundCount, detailed }: Props) => {
  const patternId = `tv-secondary-${useId().replace(/:/g, "")}`;
  const root = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 560, height: 180 });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setSize(old => old.width === width && old.height === height ? old : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { width, height } = size;
  const labelSize = Math.max(12, height * .1);
  const left = labelSize * 2.4, right = width - labelSize * 1.2;
  const bottom = height - labelSize * 1.7, top = labelSize * .7;
  const plotHeight = Math.max(1, bottom - top);
  const maxVp = Math.max(10, Math.ceil(Math.max(...totals.flat(), ...rounds.flatMap(row => row.map(s => Math.max(0, s.primary ?? 0) + Math.max(0, s.secondary ?? 0)))) / 10) * 10);
  // Reserve half a group at the right edge so both R5 bars remain inside the SVG.
  const roundStep = (right - left) / 5.3;
  const x = (r: number) => left + (r + 1) * roundStep;
  const y = (score: number) => bottom - score / maxVp * plotHeight;
  const barWidth = roundStep * .24;
  const halfGap = roundStep * .03;
  return <svg ref={root} className="overview-chart tv-score-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    role="img" aria-label="Gesamt-VP kumulativ als Linien; Primär- und Sekundär-VP je Runde als gestapelte Balken">
    <defs><pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse">
      <path d="M-1 1L1-1 M0 6L6 0 M5 7L7 5" stroke="var(--text)" strokeOpacity=".8" strokeWidth="1.5" />
    </pattern></defs>
    {[0, .5, 1].map(f => <g key={f}><line className="overview-chart__guide" x1={left} x2={right} y1={y(maxVp * f)} y2={y(maxVp * f)} />
      <text className="overview-chart__scale" x={left - labelSize * .4} y={y(maxVp * f) + labelSize * .3} textAnchor="end">{maxVp * f}</text></g>)}
    {[1, 2, 3, 4, 5].map((r, i) => <text key={r} className="overview-chart__label" x={x(i)} y={height - labelSize * .25} textAnchor="middle">R{r}</text>)}
    {colors.map((color, i) => <g key={i} style={{ color }}>
      {detailed && rounds.slice(0, roundCount).map((row, r) => {
        const primary = Math.max(0, row[i].primary ?? 0), secondary = Math.max(0, row[i].secondary ?? 0);
        const bx = x(r) + (i === 0 ? -barWidth - halfGap : halfGap);
        return <g key={r}><rect x={bx} y={y(primary)} width={barWidth} height={primary / maxVp * plotHeight} fill="currentColor" />
          <rect x={bx} y={y(primary + secondary)} width={barWidth} height={secondary / maxVp * plotHeight} fill="currentColor" />
          <rect x={bx} y={y(primary + secondary)} width={barWidth} height={secondary / maxVp * plotHeight} fill={`url(#${patternId})`} />
        </g>;
      })}
      <polyline points={[`${left},${bottom}`, ...totals[i].slice(0, roundCount).map((v, r) => `${x(r)},${y(v)}`)].join(" ")}
        fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {totals[i].slice(0, roundCount).map((v, r) => <circle key={r} cx={x(r)} cy={y(v)} r="4.5" fill="currentColor" />)}
    </g>)}
  </svg>;
};
