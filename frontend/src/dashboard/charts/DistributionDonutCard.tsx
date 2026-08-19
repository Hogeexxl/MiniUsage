import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { NumberTicker } from "../../ui/beui/number-ticker";
import { Tabs, TabsList, TabsTrigger } from "../../ui/beui/tabs";
import { formatCompact, formatCompactCost } from "../format";
import { chartColor, chartMuted } from "./chartPalette";
import { CHART_FOCUS_TRANSITION, focusOpacity } from "./chartMotion";
import { buildDistribution, type DistributionItem, type DistributionMetric } from "./distribution";

function metricText(metric: DistributionMetric, value: number) {
  return metric === "cost" ? formatCompactCost(value) : formatCompact(Math.round(value));
}

export function DistributionDonutCard({ title, items }: { title: string; items: DistributionItem[] }) {
  const [metric, setMetric] = useState<DistributionMetric>("tokens");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const data = useMemo(() => buildDistribution(items, metric), [items, metric]);
  const focused = data.segments.find((segment) => segment.id === focusedId) ?? null;
  let offset = 0;
  const centerValue = focused ? focused.value : data.total;
  const centerLabel = focused ? `${(focused.percentage * 100).toFixed(1)}%` : metric === "tokens" ? "Token" : "Cost";

  return (
    <article className="h-[264px] min-w-0 rounded-2xl border border-border bg-card p-5 text-foreground">
      <header className="flex items-center justify-between gap-4">
        <h2 className="m-0 text-sm font-medium text-foreground">{title}</h2>
        <Tabs value={metric} onValueChange={(value) => { setMetric(value as DistributionMetric); setFocusedId(null); }} variant="pill">
          <TabsList className="!p-0.5"><TabsTrigger value="tokens" className="!px-2.5 !py-1 text-xs">Token</TabsTrigger><TabsTrigger value="cost" className="!px-2.5 !py-1 text-xs">费用</TabsTrigger></TabsList>
        </Tabs>
      </header>
      <div className="mt-4 grid min-w-0 grid-cols-[152px_minmax(0,1fr)] items-center gap-4">
        <div className="relative h-[152px] w-[152px]">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" role="img" aria-label={`${title}${metric === "tokens" ? "Token" : "费用"}分布`}>
            <circle cx="60" cy="60" r="44" pathLength="100" fill="none" stroke={chartMuted} strokeWidth="8" />
            {data.segments.filter((segment) => segment.percentage > 0).map((segment) => {
              const percent = segment.percentage * 100;
              const current = offset;
              offset += percent;
              return (
                <motion.circle
                  key={segment.id}
                  cx="60" cy="60" r="44" pathLength="100" fill="none" stroke={chartColor(segment.id)} strokeWidth="8" strokeLinecap="butt"
                  strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-current}
                  animate={{ opacity: focusOpacity(focusedId, segment.id) }} transition={reduce ? { duration: 0 } : CHART_FOCUS_TRANSITION}
                  onPointerEnter={() => setFocusedId(segment.id)} onPointerLeave={() => setFocusedId(null)}
                />
              );
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {metric === "cost" ? <NumberTicker value={Math.round(centerValue * 100)} blur format={(next) => formatCompactCost(next / 100)} className="text-lg font-semibold leading-6 text-foreground" /> : <NumberTicker value={Math.round(centerValue)} blur format={formatCompact} className="text-lg font-semibold leading-6 text-foreground" />}
            <span className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{centerLabel}</span>
          </div>
        </div>
        <div className="min-w-0 space-y-1">
          {data.segments.map((segment) => (
            <button
              type="button" key={segment.id} title={segment.title}
              className="grid w-full grid-cols-[8px_minmax(0,1fr)_auto_auto] items-center gap-x-2 rounded-lg px-1.5 py-1 text-[11px] leading-4 hover:bg-primary/5 focus-visible:bg-primary/5"
              style={{ opacity: focusOpacity(focusedId, segment.id) }}
              onPointerEnter={() => setFocusedId(segment.id)} onPointerLeave={() => setFocusedId(null)} onFocus={() => setFocusedId(segment.id)} onBlur={() => setFocusedId(null)}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: chartColor(segment.id) }} />
              <span className="min-w-0 truncate text-left text-muted-foreground">{segment.label}</span>
              <span className="tabular-nums text-foreground">{metricText(metric, segment.value)}</span>
              <span className="w-11 text-right tabular-nums text-muted-foreground">{(segment.percentage * 100).toFixed(1)}%</span>
            </button>
          ))}
          {data.segments.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">暂无数据</div> : null}
        </div>
      </div>
    </article>
  );
}
