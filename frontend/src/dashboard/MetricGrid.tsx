import { CircleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import type { SummaryUsageDto } from "../data/types";
import { NumberTicker } from "../ui/beui/number-ticker";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/beui/popover";
import { TiltCard } from "../ui/beui/tilt-card";
import { formatCompact, formatCompactCost } from "./format";

type MetricGridProps = { usage: SummaryUsageDto | null; modelFilterActive: boolean };
type Focus = "input" | "output" | "reasoning" | null;
type CacheFocus = "cached" | "input" | null;

const CARD = "h-36 border border-border bg-card p-5 text-foreground";
const TITLE = "text-[11px] font-medium leading-4 text-muted-foreground";
const VALUE = "mt-1 text-[28px] font-semibold leading-8 tracking-tight text-foreground";
const LEGEND = "text-[11px] leading-4 text-muted-foreground";

function CompactTicker({ value, title }: { value: number; title?: string }) {
  return (
    <span title={title ?? String(value)}>
      <NumberTicker value={value} blur format={formatCompact} className={VALUE} />
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} />;
}

function TotalTokenMetric({ usage }: { usage: SummaryUsageDto }) {
  const reduce = useReducedMotion();
  const [focus, setFocus] = useState<Focus>(null);
  const total = usage.total_tokens;
  const inputPct = total > 0 ? (usage.input_tokens / total) * 100 : 0;
  const outputPct = total > 0 ? (usage.output_tokens / total) * 100 : 0;
  const reasoningPct = total > 0 ? (usage.reasoning_tokens / total) * 100 : 0;
  const dim = (key: Exclude<Focus, null>) => focus !== null && focus !== key;
  const transition = reduce ? { duration: 0 } : { duration: 0.18 };

  return (
    <TiltCard className={`${CARD} min-w-0 max-[1279px]:col-span-2 max-[767px]:col-span-1`}>
      <div className={TITLE}>总 Token</div>
      <CompactTicker value={total} />
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-label="输入与输出 Token 构成；推理 Token 包含在输出 Token 中">
        <motion.div
          className="absolute inset-y-0 left-0 bg-accent"
          style={{ width: `${inputPct}%` }}
          animate={{ opacity: dim("input") ? 0.3 : 1, scaleY: focus === "input" && !reduce ? 1.25 : 1 }}
          transition={transition}
        />
        <motion.div
          className="absolute inset-y-0 bg-violet"
          style={{ left: `${inputPct}%`, width: `${outputPct}%`, zIndex: focus === "output" ? 3 : 1 }}
          animate={{ opacity: dim("output") && focus !== "reasoning" ? 0.3 : 1, scaleY: focus === "output" && !reduce ? 1.25 : 1 }}
          transition={transition}
        />
        <motion.div
          className="absolute inset-y-0 right-0 bg-neon"
          style={{ width: `${reasoningPct}%`, zIndex: focus === "output" ? 0 : 2 }}
          animate={{ opacity: focus === "output" ? 0 : dim("reasoning") ? 0.3 : 1, scaleY: focus === "reasoning" && !reduce ? 1.25 : 1 }}
          transition={transition}
        />
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-4 whitespace-nowrap">
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("input")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("input")} onBlur={() => setFocus(null)}>
          <Dot className="bg-accent" />输入 <NumberTicker value={usage.input_tokens} blur format={formatCompact} className="text-foreground" />
        </button>
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("output")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("output")} onBlur={() => setFocus(null)}>
          <Dot className="bg-violet" />输出 <NumberTicker value={usage.output_tokens} blur format={formatCompact} className="text-foreground" />
        </button>
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("reasoning")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("reasoning")} onBlur={() => setFocus(null)} aria-label={`推理 ${formatCompact(usage.reasoning_tokens)}，包含在输出 Token 中`}>
          <Dot className="bg-neon" />推理 <NumberTicker value={usage.reasoning_tokens} blur format={formatCompact} className="text-foreground" />
        </button>
      </div>
    </TiltCard>
  );
}

function CacheHitMetric({ usage }: { usage: SummaryUsageDto }) {
  const reduce = useReducedMotion();
  const [focus, setFocus] = useState<CacheFocus>(null);
  const input = usage.input_tokens;
  const cached = usage.cached_tokens;
  const rate = usage.cache_hit_rate;
  const cachedPct = input > 0 ? Math.min(100, (cached / input) * 100) : 0;

  return (
    <TiltCard className={CARD}>
      <div className={TITLE}>缓存命中</div>
      {rate === null ? (
        <div className={VALUE}>—</div>
      ) : (
        <span title={`${(rate * 100).toFixed(1)}%`}>
          <NumberTicker value={Math.round(rate * 1000)} blur format={(next) => `${(next / 10).toFixed(1)}%`} className={VALUE} />
        </span>
      )}
      <motion.div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-muted" animate={{ scaleY: focus !== null && !reduce ? 1.12 : 1 }}>
        <motion.div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${cachedPct}%` }} />
        <motion.div className="absolute inset-y-0 right-0 bg-muted-foreground/15" style={{ width: `${100 - cachedPct}%` }} animate={{ opacity: focus === "cached" ? 0.25 : 1 }} />
      </motion.div>
      <div className="mt-2 flex items-center gap-4 whitespace-nowrap">
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("cached")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("cached")} onBlur={() => setFocus(null)}>
          <Dot className="bg-accent" />缓存读取 <NumberTicker value={cached} blur format={formatCompact} className="text-foreground" />
        </button>
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("input")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("input")} onBlur={() => setFocus(null)}>
          输入 <NumberTicker value={input} blur format={formatCompact} className="text-foreground" />
        </button>
      </div>
    </TiltCard>
  );
}

function SessionCountMetric({ usage }: { usage: SummaryUsageDto }) {
  return (
    <TiltCard className={`${CARD} flex flex-col`}>
      <div className={TITLE}>会话数量</div>
      <CompactTicker value={usage.session_health.total_sessions} />
      <div className={`${LEGEND} mt-auto`}>仅统计主线程会话。</div>
    </TiltCard>
  );
}

function EstimatedCostMetric({ usage }: { usage: SummaryUsageDto }) {
  const total = usage.session_count;
  const complete = Math.max(0, total - usage.cost_incomplete_session_count);
  const message = usage.estimated_cost_status === "partial" ? "有部分费用不完整" : "当前费用无法完整估算";

  return (
    <TiltCard className={`${CARD} flex flex-col`}>
      <div className="flex items-center justify-between gap-2">
        <div className={TITLE}>预估费用</div>
        {usage.estimated_cost_status !== "complete" ? (
          <Popover>
            <PopoverTrigger>
              <button type="button" aria-label="预估费用完整性提示" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-destructive hover:bg-destructive/10">
                <CircleAlert className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-max max-w-64 text-xs">{message}</PopoverContent>
          </Popover>
        ) : null}
      </div>
      {usage.estimated_cost === null ? (
        <div className={VALUE}>—</div>
      ) : (
        <span title={`$${usage.estimated_cost.toFixed(2)}`}>
          <NumberTicker value={Math.round(usage.estimated_cost * 100)} blur format={(next) => formatCompactCost(next / 100)} className={VALUE} />
        </span>
      )}
      <div className={`${LEGEND} mt-auto`}>{complete} / {total} 会话完整计价</div>
    </TiltCard>
  );
}

function SkeletonCard({ wide = false }: { wide?: boolean }) {
  return (
    <div aria-hidden className={`h-36 animate-pulse rounded-2xl border border-border bg-card p-5 ${wide ? "min-w-0 max-[1279px]:col-span-2 max-[767px]:col-span-1" : ""}`}>
      <div className="h-3 w-20 rounded bg-muted" />
      <div className="mt-3 h-8 w-28 rounded bg-muted" />
      <div className="mt-3 h-1.5 rounded-full bg-muted" />
    </div>
  );
}

export function MetricGrid({ usage, modelFilterActive }: MetricGridProps) {
  return (
    <div className="grid gap-4 [grid-template-columns:minmax(488px,1fr)_repeat(3,236px)] max-[1279px]:[grid-template-columns:minmax(0,1fr)_236px] max-[767px]:grid-cols-1" aria-label={usage ? "KPI 指标" : "KPI 加载中"}>
      {!usage ? (
        <>
          <SkeletonCard wide />
          <SkeletonCard />
          {!modelFilterActive ? <SkeletonCard /> : null}
          <SkeletonCard />
        </>
      ) : (
        <>
          <TotalTokenMetric usage={usage} />
          <CacheHitMetric usage={usage} />
          {!modelFilterActive ? <SessionCountMetric usage={usage} /> : null}
          <EstimatedCostMetric usage={usage} />
        </>
      )}
    </div>
  );
}
