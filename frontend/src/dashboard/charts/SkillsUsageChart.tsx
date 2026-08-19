import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import type { SkillsUsageResponse } from "../../data/types";
import { NumberTicker } from "../../ui/beui/number-ticker";
import { formatCompact } from "../format";
import { chartColor } from "./chartPalette";
import { CHART_FOCUS_TRANSITION, focusOpacity } from "./chartMotion";
import { buildMonotoneAreaPath } from "./monotoneArea";
import { buildSkillSeries, niceScale } from "./skillSeries";

export function SkillsUsageChart({ response }: { response: SkillsUsageResponse | null }) {
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const data = useMemo(() => buildSkillSeries(response?.days ?? []), [response]);

  if (!response || (response.data_status === "rebuilding" && data.days.length === 0)) {
    return <article className="mt-4 rounded-2xl border border-border bg-card p-5"><div className="h-3 w-24 animate-pulse rounded bg-muted" /><div className="mt-3 h-7 w-20 animate-pulse rounded bg-muted" /><div className="mt-5 h-[168px] animate-pulse rounded-xl bg-muted" /></article>;
  }

  const width = 900;
  const top = 14;
  const left = 44;
  const right = 12;
  const plotHeight = 168;
  const axisHeight = 28;
  const svgHeight = top + plotHeight + axisHeight;
  const plotWidth = width - left - right;
  const x = (index: number) => left + (data.days.length <= 1 ? plotWidth / 2 : (index * plotWidth) / (data.days.length - 1));
  const stackedTotals = data.days.map((_, dayIndex) => data.series.reduce((sum, series) => sum + series.counts[dayIndex], 0));
  const scale = niceScale(Math.max(0, ...stackedTotals));
  const y = (value: number) => top + plotHeight - (value / scale.max) * plotHeight;
  const lower = Array(data.days.length).fill(0) as number[];
  const areas = data.series.map((series) => {
    const upper = lower.map((value, dayIndex) => value + series.counts[dayIndex]);
    const topPoints = upper.map((value, dayIndex) => ({ x: x(dayIndex), y: y(value) }));
    const bottomPoints = lower.map((value, dayIndex) => ({ x: x(dayIndex), y: y(value) }));
    const path = buildMonotoneAreaPath(topPoints, bottomPoints);
    lower.splice(0, lower.length, ...upper);
    return { ...series, path };
  });
  const hoverDay = hoveredDay === null ? null : data.days[hoveredDay];
  const hoverRows = hoveredDay === null ? [] : data.series
    .map((series) => ({ id: series.id, label: series.label, count: series.counts[hoveredDay] }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return (
    <article className="mt-4 min-w-0 rounded-2xl border border-border bg-card p-5 text-foreground">
      <header>
        <h2 className="m-0 text-sm font-medium text-foreground">Skills used</h2>
        <NumberTicker value={data.total} blur format={formatCompact} className="mt-1 text-[28px] font-semibold leading-8 tracking-tight text-foreground" title={String(data.total)} />
      </header>
      {data.days.length === 7 ? (
        <div className="relative mt-3 min-w-0">
          <svg viewBox={`0 0 ${width} ${svgHeight}`} className="block w-full" role="img" aria-label="最近 7 个自然日 Skills 使用次数">
            {scale.ticks.map((tick) => <g key={tick}><line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} stroke="var(--border)" strokeWidth="1" /><text x={left - 8} y={y(tick) + 3} textAnchor="end" fill="var(--muted-foreground)" fontSize="10">{tick}</text></g>)}
            {areas.map((area) => <motion.path key={area.id} d={area.path} fill={chartColor(area.id)} fillOpacity="0.72" animate={{ opacity: focusOpacity(focusedId, area.id) }} transition={reduce ? { duration: 0 } : CHART_FOCUS_TRANSITION} onPointerEnter={() => setFocusedId(area.id)} onPointerLeave={() => setFocusedId(null)} />)}
            {data.days.map((day, index) => {
              const zoneWidth = plotWidth / 7;
              return <g key={day.date}><text x={x(index)} y={top + plotHeight + 20} textAnchor="middle" fill="var(--muted-foreground)" fontSize="10">{day.date.slice(5)}</text><rect x={Math.max(left, x(index) - zoneWidth / 2)} y={top} width={zoneWidth} height={plotHeight} fill="transparent" onPointerEnter={() => setHoveredDay(index)} onPointerLeave={() => setHoveredDay(null)} /></g>;
            })}
            {hoveredDay !== null ? <line x1={x(hoveredDay)} y1={top} x2={x(hoveredDay)} y2={top + plotHeight} stroke="var(--foreground)" strokeOpacity="0.4" strokeWidth="1" /> : null}
          </svg>

          {hoverDay && hoveredDay !== null ? (
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              className="pointer-events-none absolute z-20 min-w-52 max-w-[min(320px,80vw)] rounded-xl border border-border bg-popover p-3 text-[11px] leading-4 text-popover-foreground shadow-xl"
              style={{ left: `${(x(hoveredDay) / width) * 100}%`, top: 8, transform: hoveredDay >= 4 ? "translateX(-100%)" : "translateX(8px)" }}
            >
              <div className="mb-2 font-medium text-foreground">{hoverDay.date}</div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                {hoverRows.map((row) => <div key={row.id} className="contents"><span className="flex min-w-0 items-center gap-1.5 text-muted-foreground"><i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: chartColor(row.id) }} /><span className="truncate">{row.label}</span></span><span className="text-right tabular-nums text-foreground">{row.count}</span></div>)}
                <span className="mt-1 border-t border-border pt-1 font-semibold text-foreground">Total</span><span className="mt-1 border-t border-border pt-1 text-right font-semibold tabular-nums text-foreground">{hoverDay.total}</span>
              </div>
            </motion.div>
          ) : null}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {data.series.map((series) => <button type="button" key={series.id} className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground" style={{ opacity: focusOpacity(focusedId, series.id) }} onPointerEnter={() => setFocusedId(series.id)} onPointerLeave={() => setFocusedId(null)} onFocus={() => setFocusedId(series.id)} onBlur={() => setFocusedId(null)}><i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: chartColor(series.id) }} /><span className="max-w-44 truncate">{series.label}</span></button>)}
          </div>
        </div>
      ) : <div className="py-16 text-center text-xs text-muted-foreground">暂无 Skills 数据</div>}
    </article>
  );
}
