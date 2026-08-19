import { RefreshCw, X } from "lucide-react";
import { useEffect } from "react";

import type { SessionDetailResponse, UsageDto } from "../../data/types";
import { ActionSwapIcon } from "../../ui/beui/action-swap";
import { AnimatedToastStack, useAnimatedToastStack } from "../../ui/beui/animated-toast-stack";
import { BouncyAccordion, type BouncyAccordionItem } from "../../ui/beui/bouncy-accordion";
import { Button } from "../../ui/beui/button";
import { Drawer } from "../../ui/beui/drawer";
import { Loader } from "../../ui/beui/loader";
import { NumberTicker } from "../../ui/beui/number-ticker";
import { Tooltip } from "../../ui/beui/tooltip";
import { formatCompact, formatCost, formatRatio } from "../format";
import { CostValue } from "../shared/CostValue";
import {
  formatModelWithReasoningEffort,
  formatSessionNullableTokenInteger,
  formatSessionTime,
  formatSessionTitle,
  formatSessionTokenInteger,
} from "./sessionFormat";
import type { SessionDetailControllerViewModel } from "./useSessionDetailController";

type SessionDetailDrawerProps = { view: SessionDetailControllerViewModel; timezone: string };
const usageFields = [
  ["总 Token", "total_tokens"], ["输入 Token", "input_tokens"], ["输出 Token", "output_tokens"], ["推理 Token", "reasoning_tokens"],
  ["缓存命中率", "cache_hit_rate"], ["缓存读取", "cached_tokens"], ["缓存写入", "cache_write_tokens"], ["预估费用", "estimated_cost"],
] as const;

function usageValue(usage: UsageDto, field: (typeof usageFields)[number][1]) {
  if (field === "cache_hit_rate") return formatRatio(usage.cache_hit_rate);
  if (field === "estimated_cost") return formatCost(usage.estimated_cost);
  if (field === "cache_write_tokens") return formatSessionNullableTokenInteger(usage.cache_write_tokens);
  return formatSessionTokenInteger(usage[field]);
}

function UsageReceipt({ usage }: { usage: UsageDto }) {
  return <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-border pt-3">
    {usageFields.map(([label, field]) => {
      const value = usageValue(usage, field);
      return <div key={field} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[11px] leading-4"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 text-right tabular-nums text-foreground" title={value.title} aria-label={`${label}：${value.accessibleName}`}>{value.text}</dd></div>;
    })}
  </dl>;
}

function DetailSkeleton() {
  return <div role="status" aria-label="Session 详情加载中" className="space-y-4"><div className="grid grid-cols-4 gap-2">{Array.from({ length: 4 }, (_, index) => <span key={index} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div><div className="h-10 animate-pulse rounded-xl bg-muted" /><div className="h-28 animate-pulse rounded-xl bg-muted" /><div className="h-10 animate-pulse rounded-xl bg-muted" /></div>;
}

function mainItems(detail: SessionDetailResponse): BouncyAccordionItem[] {
  return detail.main.model_usage.map((model, index) => ({
    id: `${model.model}:${model.reasoning_effort ?? "unknown"}:${index}`,
    title: <span className="truncate" title={formatModelWithReasoningEffort(model.model, model.reasoning_effort, false)}>{formatModelWithReasoningEffort(model.model, model.reasoning_effort, false)}</span>,
    children: <UsageReceipt usage={model.usage} />,
  }));
}

function subagentItems(detail: SessionDetailResponse, timezone: string): BouncyAccordionItem[] {
  return detail.subagents.map((subagent) => {
    const title = formatSessionTitle(subagent.title);
    const time = formatSessionTime(subagent.last_activity_at_ms, timezone);
    return {
      id: subagent.thread_id,
      title: <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><span className="min-w-0"><span className="block truncate text-foreground" title={title}>{title}</span><span className="block truncate text-[10px] font-normal text-muted-foreground" title={subagent.thread_id}>{subagent.thread_id}</span></span><span className="text-right text-[10px] font-normal leading-4 text-muted-foreground"><span className="block text-foreground">{formatModelWithReasoningEffort(subagent.model, subagent.reasoning_effort, subagent.reasoning_effort_mixed)}</span><time className="block" dateTime={new Date(subagent.last_activity_at_ms).toISOString()} title={time.title}>{time.text}</time></span></span>,
      children: <UsageReceipt usage={subagent.usage} />,
    };
  });
}

export function SessionDetailDrawer({ view, timezone }: SessionDetailDrawerProps) {
  const toast = useAnimatedToastStack();
  useEffect(() => {
    if (view.refresh_error_code) toast.showToast({ status: "error", title: "详情更新失败" });
  }, [view.refresh_error_code, toast.showToast]);

  if (!view.selected_row && !view.open) return null;
  const detail = view.detail;
  const selected = view.selected_row;
  const title = formatSessionTitle(detail?.main.title ?? selected?.title ?? null);
  const timeValue = detail?.last_activity_at_ms ?? selected?.last_activity_at_ms ?? 0;
  const time = formatSessionTime(timeValue, timezone);
  const refreshing = view.load_state === "refreshing";
  const inclusive = detail?.main.inclusive_usage;
  const main = detail?.main.self_usage;
  const subagentTokens = detail ? detail.main.inclusive_usage.total_tokens - detail.main.self_usage.total_tokens : 0;

  return (
    <>
      <Drawer open={view.open} onOpenChange={(open) => { if (!open) view.close_detail(); }} side="right" ariaLabel="Session 详情" className="w-[480px] max-w-full max-[480px]:w-screen">
        <div className="flex h-full flex-col" aria-busy={view.load_state === "loading" || refreshing}>
          <header className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div className="min-w-0 flex-1">
              <Tooltip content={title} side="bottom"><h2 className="m-0 block truncate text-base font-semibold leading-6 text-foreground">{title}</h2></Tooltip>
              <Tooltip content={selected?.root_session_id ?? ""} side="bottom"><p className="mt-1 truncate text-[10px] leading-4 text-muted-foreground">{selected?.root_session_id ?? ""}</p></Tooltip>
              <time className="mt-0.5 block text-[10px] leading-4 text-muted-foreground" dateTime={timeValue > 0 ? new Date(timeValue).toISOString() : undefined} title={time.title}>{time.text}</time>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip content="刷新当前详情" side="bottom"><Button variant="ghost" size="icon" aria-label="刷新当前详情" disabled={refreshing} onClick={view.refresh_detail}><ActionSwapIcon value={refreshing ? "loading" : "idle"} animation="blur" className="h-4 w-4">{refreshing ? <Loader label="详情更新中" /> : <RefreshCw className="h-4 w-4" />}</ActionSwapIcon></Button></Tooltip>
              <Tooltip content="关闭" side="bottom"><Button variant="ghost" size="icon" aria-label="关闭 Session 详情" onClick={view.close_detail}><X className="h-4 w-4" /></Button></Tooltip>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {view.load_state === "loading" && !detail ? <DetailSkeleton /> : null}
            {view.load_state === "error" && !detail ? <div className="rounded-2xl border border-destructive/20 p-5 text-center"><p className="m-0 text-xs text-destructive">Session 详情加载失败</p><Button variant="secondary" size="sm" className="mt-3" onClick={view.retry_detail}>重试</Button></div> : null}
            {detail && inclusive && main ? <>
              <section aria-label="Session 合计" className="grid grid-cols-4 gap-2">
                <div className="rounded-xl bg-muted p-3"><span className="block text-[10px] leading-4 text-muted-foreground">合计 Token</span><NumberTicker value={inclusive.total_tokens} blur format={formatCompact} className="mt-1 text-sm font-semibold text-foreground" /></div>
                <div className="rounded-xl bg-muted p-3"><span className="block text-[10px] leading-4 text-muted-foreground">Main</span><NumberTicker value={main.total_tokens} blur format={formatCompact} className="mt-1 text-sm font-semibold text-foreground" /></div>
                <div className="rounded-xl bg-muted p-3"><span className="block text-[10px] leading-4 text-muted-foreground">Subagent</span><NumberTicker value={subagentTokens} blur format={formatCompact} className="mt-1 text-sm font-semibold text-foreground" /></div>
                <div className="rounded-xl bg-muted p-3"><span className="block text-[10px] leading-4 text-muted-foreground">合计费用</span><CostValue value={inclusive.estimated_cost} status={inclusive.estimated_cost_status} ticker className="mt-1 text-sm font-semibold text-foreground" /></div>
              </section>

              <section className="mt-5" aria-labelledby="drawer-main-heading"><h3 id="drawer-main-heading" className="mb-2 text-xs font-medium text-foreground">Main <span className="text-muted-foreground">({detail.main.model_usage.length})</span></h3><BouncyAccordion items={mainItems(detail)} defaultValue={null} /></section>
              <section className="mt-5" aria-labelledby="drawer-subagent-heading"><h3 id="drawer-subagent-heading" className="mb-2 text-xs font-medium text-foreground">Subagent <span className="text-muted-foreground">({detail.subagents.length})</span></h3>{detail.subagents.length === 0 ? <p className="m-0 rounded-xl border border-border p-4 text-xs text-muted-foreground">暂无 Subagent</p> : <BouncyAccordion items={subagentItems(detail, timezone)} defaultValue={null} />}</section>
            </> : null}
          </div>
        </div>
      </Drawer>
      <AnimatedToastStack toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </>
  );
}
