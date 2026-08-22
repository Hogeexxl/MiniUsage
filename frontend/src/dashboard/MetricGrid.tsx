import { CircleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { memo, useState } from "react";

import type { CodexQuotaResponse, SummaryUsageDto } from "../data/types";
import { chartMuted, chartSeriesColor } from "./charts/chartPalette";
import { EASE_OUT } from "../ui/lib/ease";
import { NumberTicker } from "../ui/beui/number-ticker";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/beui/popover";
import { TiltCard } from "../ui/beui/tilt-card";
import { formatCodexPlanType, formatCodexResetTime, formatCostFull, formatIntegerFull, formatRatio, type FormattedValue } from "./format";

type MetricGridProps = { usage: SummaryUsageDto | null; modelFilterActive: boolean; quota?: CodexQuotaResponse };
type Focus = "input" | "output" | "reasoning" | null;
type CacheFocus = "cached" | "input" | null;

const CARD = "h-36 min-w-0 border border-border bg-card p-5 text-foreground";
const TITLE = "text-xs font-medium leading-4 text-muted-foreground";
const VALUE = "mt-1 text-[28px] font-semibold leading-8 tracking-tight text-foreground";
const LEGEND = "text-xs leading-4 text-muted-foreground";

function CompactTicker({
  value,
  formatter,
  tickerValue = value,
  tickerFormatter,
  className = VALUE,
}: {
  value: number;
  formatter: (value: number) => FormattedValue;
  tickerValue?: number;
  tickerFormatter?: (value: number) => string;
  className?: string;
}) {
  const formatted = formatter(value);
  const visibleFormatter = tickerFormatter ?? ((next: number) => formatter(next).text);

  return (
    <span title={formatted.title} aria-label={formatted.accessibleName}>
      <NumberTicker value={tickerValue} blur format={visibleFormatter} className={className} />
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} />;
}

function TotalTokenMetric({ usage }: { usage: SummaryUsageDto }) {
  const reduce = useReducedMotion();
  const [focus, setFocus] = useState<Focus>(null);
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const reasoning = usage.reasoning_tokens;
  const total = input + output;
  const inputPct = total > 0 ? (input / total) * 100 : 0;
  const outputPct = total > 0 ? (output / total) * 100 : 0;
  const reasoningPct = total > 0 ? (reasoning / total) * 100 : 0;
  const dim = (key: Exclude<Focus, null>) => focus !== null && focus !== key;
  const transition = reduce ? { duration: 0 } : { ease: EASE_OUT };

  return (
    <TiltCard className={`${CARD} min-w-0 max-[1439px]:col-span-2 max-[767px]:col-span-1`}>
      <div className={TITLE}>总 Token</div>
      <CompactTicker value={total} formatter={formatIntegerFull} />
      <div className="relative mt-2 h-[5px] overflow-hidden rounded-full bg-muted" aria-label="输入与输出 Token 构成；推理 Token 包含在输出 Token 中">
        <motion.div
          className="absolute inset-y-0 left-0 bg-[#68c0e8]"
          style={{ width: `${inputPct}%` }}
          animate={{ opacity: dim("input") ? 0.3 : 1, scaleY: focus === "input" && !reduce ? 1.25 : 1 }}
          transition={transition}
        />
        <motion.div
          className="absolute inset-y-0 bg-[#be753e]"
          style={{ left: `${inputPct}%`, width: `${outputPct}%`, zIndex: focus === "output" ? 3 : 1 }}
          animate={{ opacity: dim("output") ? 0.3 : 1, scaleY: focus === "output" && !reduce ? 1.25 : 1 }}
          transition={transition}
        />
        <motion.div
          className="absolute inset-y-0 right-0 bg-[#a6333d]"
          style={{ width: `${reasoningPct}%`, zIndex: focus === "output" ? 0 : 2 }}
          animate={{ opacity: focus === "output" ? 0 : dim("reasoning") ? 0.3 : 1, scaleY: focus === "reasoning" && !reduce ? 1.25 : 1 }}
          transition={transition}
        />
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-4 whitespace-nowrap">
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("input")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("input")} onBlur={() => setFocus(null)}>
          <Dot className="bg-[#68c0e8]" />输入 <CompactTicker value={input} formatter={formatIntegerFull} className="text-foreground" />
        </button>
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("output")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("output")} onBlur={() => setFocus(null)}>
          <Dot className="bg-[#be753e]" />输出 <CompactTicker value={output} formatter={formatIntegerFull} className="text-foreground" />
        </button>
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("reasoning")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("reasoning")} onBlur={() => setFocus(null)} aria-label={`推理 ${formatIntegerFull(reasoning).accessibleName}，包含在输出 Token 中`}>
          <Dot className="bg-[#a6333d]" />推理 <CompactTicker value={reasoning} formatter={formatIntegerFull} className="text-foreground" />
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
  const cachedPct = input > 0 ? Math.min(1, Math.max(0, cached / input)) * 100 : 0;

  return (
    <TiltCard className={CARD}>
      <div className={TITLE}>缓存命中</div>
      {rate === null ? (
        <div className={VALUE}>—</div>
      ) : (
        <CompactTicker value={rate} tickerValue={Math.round(rate * 1000)} formatter={formatRatio} tickerFormatter={(next) => formatRatio(next / 1000).text} />
      )}
      <motion.div className="relative mt-2 h-[5px] overflow-hidden rounded-full bg-muted" animate={{ scaleY: focus !== null && !reduce ? 1.12 : 1 }} transition={reduce ? { duration: 0 } : { ease: EASE_OUT }}>
        <motion.div className="absolute inset-y-0 left-0 bg-[#be506e]" style={{ width: `${cachedPct}%` }} transition={reduce ? { duration: 0 } : { ease: EASE_OUT }} />
        <motion.div className="absolute inset-y-0 right-0 bg-[#4057a5]" style={{ width: `${100 - cachedPct}%` }} animate={{ opacity: focus === "cached" ? 0.3 : 1 }} transition={reduce ? { duration: 0 } : { ease: EASE_OUT }} />
      </motion.div>
      <div className="mt-2 flex items-center gap-4 whitespace-nowrap">
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("cached")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("cached")} onBlur={() => setFocus(null)}>
          <Dot className="bg-[#be506e]" />缓存读 <CompactTicker value={cached} formatter={formatIntegerFull} className="text-foreground" />
        </button>
        <button type="button" className={`${LEGEND} flex items-center gap-1.5`} onPointerEnter={() => setFocus("input")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("input")} onBlur={() => setFocus(null)}>
          <Dot className="bg-[#4057a5]" />输入 <CompactTicker value={input} formatter={formatIntegerFull} className="text-foreground" />
        </button>
      </div>
    </TiltCard>
  );
}

function SessionCountMetric({ usage }: { usage: SummaryUsageDto }) {
  return (
    <TiltCard className={`${CARD} flex flex-col`}>
      <div className={TITLE}>会话数量</div>
      <CompactTicker value={usage.session_health.total_sessions} formatter={formatIntegerFull} />
      <div className={`${LEGEND} mt-auto`}>仅统计主线程会话。</div>
    </TiltCard>
  );
}

function EstimatedCostMetric({ usage }: { usage: SummaryUsageDto }) {
  const total = usage.session_health.total_sessions;
  const complete = total - usage.cost_incomplete_session_count;
  const message = usage.estimated_cost_status === "partial" ? "有部分费用不完整" : "当前费用无法完整估算";

  return (
    <TiltCard className={`${CARD} flex flex-col`}>
      <div className="flex items-center justify-between gap-2">
        <div className={TITLE}>预估费用</div>
        {usage.estimated_cost_status !== "complete" ? (
          <Popover side="bottom" align="end">
            <PopoverTrigger>
              <button type="button" aria-label="预估费用完整性提示" className="inline-flex items-center justify-center text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
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
        <CompactTicker value={usage.estimated_cost} tickerValue={Math.round(usage.estimated_cost * 100)} formatter={formatCostFull} tickerFormatter={(next) => formatCostFull(next / 100).text} />
      )}
      <div className={`${LEGEND} mt-auto`}>{complete} / {total} 会话完整计价</div>
    </TiltCard>
  );
}

export function codexQuotaColor(remainingPercent: number): string {
  if (remainingPercent >= 60) return chartSeriesColor(8);
  if (remainingPercent >= 20) return chartSeriesColor(5);
  return chartSeriesColor(9);
}

function CodexQuotaCard({ quota }: { quota: CodexQuotaResponse }) {
  if (quota.status === "loading") return <SkeletonCard bar />;

  const weekly = quota.status === "ready" ? quota.weekly : null;
  if (weekly === null) {
    return (
      <TiltCard className={`${CARD} flex flex-col`}>
        <div className={TITLE}>剩余配额</div>
        <div className={VALUE}>—</div>
        <div className={`${LEGEND} mt-auto`}>暂时无法获取配额</div>
      </TiltCard>
    );
  }

  const plan = formatCodexPlanType(quota.plan_type);
  const email = quota.account_email || "—";
  const resetCredits = quota.reset_credits_available === null ? "—" : `${quota.reset_credits_available} 次`;
  const remaining = Math.round(weekly.remaining_percent);

  return (
    <TiltCard className={`${CARD} flex flex-col`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className={`${TITLE} min-w-0`}>剩余配额</div>
        <Popover trigger="hover" side="bottom" align="end">
          <PopoverTrigger>
            <button type="button" className="min-w-0 truncate text-xs font-medium leading-4 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              {plan}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-max max-w-64 text-xs">
            <div className="flex flex-col gap-1">
              <div>{email}</div>
              <div>重置卡：{resetCredits}</div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <span className={VALUE} title={`${remaining}%`} aria-label={`${remaining}%`}>
        <NumberTicker value={weekly.remaining_percent} blur format={(value) => `${value}%`} />
      </span>
      <div className="relative mt-2 h-[5px] overflow-hidden rounded-full bg-muted" aria-label="剩余与已使用配额">
        <div className="absolute inset-y-0 left-0" style={{ width: `${weekly.remaining_percent}%`, backgroundColor: codexQuotaColor(weekly.remaining_percent) }} />
        <div className="absolute inset-y-0 right-0" style={{ width: `${100 - weekly.remaining_percent}%`, backgroundColor: chartMuted }} />
      </div>
      <div className={`${LEGEND} mt-auto`}>下次重置 · {formatCodexResetTime(weekly.reset_at_ms)}</div>
    </TiltCard>
  );
}

function SkeletonCard({ wide = false, bar = false }: { wide?: boolean; bar?: boolean }) {
  return (
      <div aria-hidden className={`h-36 animate-pulse rounded-2xl border border-border bg-card p-5 ${wide ? "min-w-0 max-[1439px]:col-span-2 max-[767px]:col-span-1" : ""}`}>
      <div className="h-3 w-20 rounded bg-muted" />
      <div className="mt-3 h-8 w-28 rounded bg-muted" />
      {bar ? <div className="mt-3 h-[5px] rounded-full bg-muted" /> : null}
    </div>
  );
}

const LOADING_QUOTA: CodexQuotaResponse = {
  status: "loading",
  account_email: null,
  plan_type: null,
  weekly: null,
  reset_credits_available: null,
  fetched_at_ms: null,
};

export const MetricGrid = memo(function MetricGrid({ usage, modelFilterActive, quota = LOADING_QUOTA }: MetricGridProps) {
  const columns = modelFilterActive
    ? "[grid-template-columns:minmax(0,1fr)_repeat(3,236px)]"
    : "[grid-template-columns:minmax(0,1fr)_repeat(4,236px)]";

  return (
    <div className={`grid gap-4 ${columns} max-[1439px]:[grid-template-columns:minmax(0,1fr)_236px] max-[767px]:grid-cols-1`} aria-label={usage ? "KPI 指标" : "KPI 加载中"}>
      {!usage ? (
        <>
          <SkeletonCard wide bar />
          <SkeletonCard bar />
          {!modelFilterActive ? <SkeletonCard /> : null}
          <SkeletonCard />
          <SkeletonCard bar />
        </>
      ) : (
        <>
          <TotalTokenMetric usage={usage} />
          <CacheHitMetric usage={usage} />
          {!modelFilterActive ? <SessionCountMetric usage={usage} /> : null}
          <EstimatedCostMetric usage={usage} />
          <CodexQuotaCard quota={quota} />
        </>
      )}
    </div>
  );
});
