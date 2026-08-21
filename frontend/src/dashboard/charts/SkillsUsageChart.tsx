import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState, type PointerEvent } from "react";
import type { SkillsUsageResponse } from "../../data/types";
import { NumberTicker } from "../../ui/beui/number-ticker";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/beui/popover";
import { SPRING_LAYOUT } from "../../ui/lib/ease";
import { formatCompact } from "../format";
import { chartSeriesColor } from "./chartPalette";
import { focusOpacity } from "./chartMotion";
import { ChartSurface } from "./ChartSurface";
import { buildMonotoneAreaPath } from "./monotoneArea";
import { buildSkillSeries, niceScale } from "./skillSeries";

type SkillPopoverState = { id: string; mode: "area" | "legend" } | null;
type SkillPopoverAnchor = { left: number; top: number };

function formatShortDate(date: string) {
  return date.slice(5);
}

export function SkillsUsageChart({ response, className }: { response: SkillsUsageResponse | null; className?: string }) {
  const [plotHoveredDay, setPlotHoveredDay] = useState<number | null>(null);
  const [popoverDay, setPopoverDay] = useState<number | null>(null);
  const [areaHoverId, setAreaHoverId] = useState<string | null>(null);
  const [legendHoverId, setLegendHoverId] = useState<string | null>(null);
  const [legendFocusId, setLegendFocusId] = useState<string | null>(null);
  const [skillPopover, setSkillPopover] = useState<SkillPopoverState>(null);
  const [skillPopoverAnchor, setSkillPopoverAnchor] = useState<SkillPopoverAnchor>({ left: 0, top: 0 });
  const reduce = useReducedMotion();
  const data = useMemo(() => buildSkillSeries(response?.days ?? []), [response]);

  if (!response || (response.data_status === "rebuilding" && data.total === 0)) {
    return <ChartSurface className={className}><div className="h-3 w-24 animate-pulse rounded bg-muted" /><div className="mt-3 h-7 w-20 animate-pulse rounded bg-muted" /><div className="mt-5 h-[168px] animate-pulse rounded-xl bg-muted" /></ChartSurface>;
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
  const areas = data.series.map((series, index) => {
    const upper = lower.map((value, dayIndex) => value + series.counts[dayIndex]);
    const topPoints = upper.map((value, dayIndex) => ({ x: x(dayIndex), y: y(value) }));
    const bottomPoints = lower.map((value, dayIndex) => ({ x: x(dayIndex), y: y(value) }));
    const path = buildMonotoneAreaPath(topPoints, bottomPoints);
    lower.splice(0, lower.length, ...upper);
    return { ...series, index, color: chartSeriesColor(index, series.isOther), path };
  });
  const activeDay = plotHoveredDay ?? popoverDay;
  const focusedId = skillPopover?.id ?? legendFocusId ?? legendHoverId ?? areaHoverId;
  const activeSkill = skillPopover ? data.series.find((series) => series.id === skillPopover.id) ?? null : null;
  const skillDayIndex = data.days.length === 0
    ? 0
    : Math.max(0, Math.min(data.days.length - 1, plotHoveredDay ?? 0));
  const displayedTotal = activeSkill?.total ?? data.total;
  const rowsForDay = (dayIndex: number) => data.series
    .map((series, index) => ({ id: series.id, label: series.label, count: series.counts[dayIndex], index, isOther: series.isOther }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const updateSkillPopoverAnchor = (target: Element, clientX?: number, clientY?: number) => {
    const rect = target.getBoundingClientRect();
    const left = Number.isFinite(clientX) ? clientX as number : rect.left + rect.width / 2;
    const top = Number.isFinite(clientY) ? clientY as number : rect.top + rect.height / 2;
    setSkillPopoverAnchor((current) => current.left === left && current.top === top ? current : { left, top });
  };

  const showSkillPopover = (
    id: string,
    mode: "area" | "legend",
    target: Element,
    clientX?: number,
    clientY?: number,
  ) => {
    updateSkillPopoverAnchor(target, clientX, clientY);
    setSkillPopover({ id, mode });
  };

  const resetSkillInteraction = () => {
    setAreaHoverId(null);
    setLegendHoverId(null);
    setLegendFocusId(null);
    setSkillPopover(null);
  };

  const handleDateIntent = () => {
    setPlotHoveredDay(null);
    resetSkillInteraction();
  };

  const handlePlotPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || data.days.length === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * width;
    const clampedX = Math.min(width - right, Math.max(left, viewX));
    const ratio = (clampedX - left) / plotWidth;
    const index = Math.round(ratio * (data.days.length - 1));
    setPlotHoveredDay(Math.max(0, Math.min(data.days.length - 1, index)));
    if (skillPopover?.mode === "area") {
      setSkillPopoverAnchor((current) =>
        current.left === event.clientX && current.top === event.clientY
          ? current
          : { left: event.clientX, top: event.clientY },
      );
    }
  };

  return (
    <ChartSurface className={className}>
      <header>
        <h2 className="m-0 text-sm font-medium text-foreground">Skills Used</h2>
        <span title={String(displayedTotal)}>
          <NumberTicker value={displayedTotal} blur format={formatCompact} className="mt-1 text-[28px] font-semibold leading-8 tracking-tight text-foreground" />
        </span>
      </header>
      {data.days.length === 7 ? (
        <div className="mt-3 min-w-0">
          <Popover
            open={skillPopover !== null}
            onOpenChange={(open) => {
              if (!open) setSkillPopover(null);
            }}
            side="top"
            align="center"
            className="pointer-events-none h-0 w-0"
          >
            <PopoverTrigger>
              <span
                aria-hidden="true"
                data-skill-popover-anchor=""
                className="block h-px w-px"
                style={{
                  position: "fixed",
                  left: `${skillPopoverAnchor.left}px`,
                  top: `${skillPopoverAnchor.top}px`,
                  width: "1px",
                  height: "1px",
                  opacity: 0,
                  pointerEvents: "none",
                }}
              />
            </PopoverTrigger>
            {activeSkill && skillPopover ? (
              <PopoverContent className="w-max max-w-[min(320px,80vw)]">
                <div className="mb-2 text-xs font-medium text-foreground">{activeSkill.label}</div>
                {skillPopover.mode === "area" ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                    <span className="text-xs font-normal text-muted-foreground">{data.days[skillDayIndex]?.date}</span>
                    <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{activeSkill.counts[skillDayIndex] ?? 0}</span>
                    <span className="mt-1 border-t border-border pt-1 text-xs font-semibold text-foreground">7日总数</span>
                    <span className="mt-1 border-t border-border pt-1 text-right text-xs font-semibold tabular-nums text-foreground">{activeSkill.total}</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                    {data.days.map((day, index) => (
                      <div key={day.date} className="contents">
                        <span className="text-xs font-normal text-muted-foreground">{day.date}</span>
                        <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{activeSkill.counts[index] ?? 0}</span>
                      </div>
                    ))}
                    <span className="mt-1 border-t border-border pt-1 text-xs font-semibold text-foreground">7日总数</span>
                    <span className="mt-1 border-t border-border pt-1 text-right text-xs font-semibold tabular-nums text-foreground">{activeSkill.total}</span>
                  </div>
                )}
              </PopoverContent>
            ) : null}
          </Popover>
          <div className="relative min-w-0">
            <svg
              viewBox={`0 0 ${width} ${svgHeight}`}
              className="block w-full"
              role="img"
              aria-label="最近 7 个自然日 Skills 使用次数"
              onPointerMove={handlePlotPointerMove}
              onPointerLeave={() => setPlotHoveredDay(null)}
            >
              {scale.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} stroke="var(--border)" strokeWidth="1" />
                  <text x={left - 8} y={y(tick) + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize={12}>{tick}</text>
                </g>
              ))}
              {areas.map((area) => (
                <motion.path
                  key={area.id}
                  d={area.path}
                  fill={area.color}
                  fillOpacity="0.72"
                  animate={{ opacity: focusOpacity(focusedId, area.id) }}
                  transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                  onPointerEnter={(event) => {
                    setAreaHoverId(area.id);
                    showSkillPopover(area.id, "area", event.currentTarget, event.clientX, event.clientY);
                  }}
                  onPointerLeave={() => {
                    setAreaHoverId(null);
                    setSkillPopover((current) => current?.mode === "area" && current.id === area.id ? null : current);
                  }}
                />
              ))}
              {activeDay !== null ? <line x1={x(activeDay)} y1={top} x2={x(activeDay)} y2={top + plotHeight} stroke="var(--foreground)" strokeOpacity="0.4" strokeWidth="1" pointerEvents="none" /> : null}
            </svg>
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${(left / width) * 100}%`,
                right: `${(right / width) * 100}%`,
                top: `${((top + plotHeight) / svgHeight) * 100}%`,
                height: `${(axisHeight / svgHeight) * 100}%`,
              }}
            >
              <div className="pointer-events-auto grid h-full grid-cols-7">
                {data.days.map((day, index) => (
                  <Popover
                    key={day.date}
                    trigger="hover"
                    open={skillPopover === null && activeDay === index}
                    onOpenChange={(open) => {
                      if (open) handleDateIntent();
                      setPopoverDay((current) => open || current !== index ? (open ? index : current) : null);
                    }}
                    side="top"
                    align="center"
                    className="h-full w-full"
                  >
                    <PopoverTrigger>
                      <button
                        type="button"
                        aria-label={day.date}
                        className="h-full w-full text-center text-xs leading-4 text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                        onPointerEnter={handleDateIntent}
                        onFocus={handleDateIntent}
                      >
                        {formatShortDate(day.date)}
                      </button>
                    </PopoverTrigger>
                    {skillPopover === null && popoverDay === index ? (
                      <PopoverContent className="w-max max-w-[min(320px,80vw)]">
                        <div className="mb-2 text-xs font-medium text-foreground">{day.date}</div>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                          {rowsForDay(index).map((row) => (
                            <div key={row.id} className="contents">
                              <span className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chartSeriesColor(row.index, row.isOther) }} />
                                <span className="truncate">{row.label}</span>
                              </span>
                              <span className="text-right text-xs font-normal tabular-nums text-muted-foreground">{row.count}</span>
                            </div>
                          ))}
                          <span className="mt-1 border-t border-border pt-1 text-xs font-semibold text-foreground">Total</span>
                          <span className="mt-1 border-t border-border pt-1 text-right text-xs font-semibold tabular-nums text-foreground">{day.total}</span>
                        </div>
                      </PopoverContent>
                    ) : null}
                  </Popover>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {data.series.map((series, index) => (
              <motion.button
                type="button"
                key={series.id}
                className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground"
                animate={{ opacity: focusOpacity(focusedId, series.id) }}
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                aria-haspopup="dialog"
                aria-expanded={skillPopover?.mode === "legend" && skillPopover.id === series.id}
                onPointerEnter={(event) => {
                  setLegendHoverId(series.id);
                  showSkillPopover(series.id, "legend", event.currentTarget, event.clientX, event.clientY);
                }}
                onPointerLeave={() => {
                  setLegendHoverId(null);
                  setSkillPopover((current) => current?.mode === "legend" && current.id === series.id && legendFocusId === null ? null : current);
                }}
                onFocus={(event) => {
                  setLegendFocusId(series.id);
                  showSkillPopover(series.id, "legend", event.currentTarget);
                }}
                onBlur={() => {
                  setLegendFocusId(null);
                  setSkillPopover((current) => current?.mode === "legend" && current.id === series.id && legendHoverId === null ? null : current);
                }}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chartSeriesColor(index, series.isOther) }} />
                <span className="max-w-44 truncate">{series.label}</span>
              </motion.button>
            ))}
          </div>
        </div>
      ) : <div className="py-16 text-center text-xs text-muted-foreground">暂无 Skills 数据</div>}
    </ChartSurface>
  );
}
