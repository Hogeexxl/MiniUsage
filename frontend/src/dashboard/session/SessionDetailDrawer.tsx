import { RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { MainModelUsageDto, SessionDetailResponse, SubagentDetailDto, UsageDto } from "../../data/types";
import { ActionSwapIcon } from "../../ui/beui/action-swap";
import { AnimatedToastStack, useAnimatedToastStack } from "../../ui/beui/animated-toast-stack";
import { BouncyAccordion } from "../../ui/beui/bouncy-accordion";
import { Button } from "../../ui/beui/button";
import { Drawer } from "../../ui/beui/drawer";
import { Loader } from "../../ui/beui/loader";
import { NumberTicker } from "../../ui/beui/number-ticker";
import { Tooltip } from "../../ui/beui/tooltip";
import { formatRatio } from "../format";
import { CostValue } from "../shared/CostValue";
import { formatModelWithReasoningEffort, formatSessionTime, formatSessionTitle } from "./sessionFormat";
import type { SessionDetailControllerViewModel } from "./useSessionDetailController";

type SessionDetailDrawerProps = { view: SessionDetailControllerViewModel; timezone: string };

function StaticValue({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  return <span className="tabular-nums text-foreground" aria-label={ariaLabel}>{value}</span>;
}

function UsageReceipt({ usage }: { usage: UsageDto }) {
  const rows = [
    ["Total Tokens", String(usage.total_tokens), `Total Tokens：${usage.total_tokens}`, true],
    ["Input", String(usage.input_tokens), `Input：${usage.input_tokens}`, false],
    ["Output", String(usage.output_tokens), `Output：${usage.output_tokens}`, false],
    ["Reasoning", String(usage.reasoning_tokens), `Reasoning：${usage.reasoning_tokens}`, false],
    ["Cache Read", String(usage.cached_tokens), `Cache Read：${usage.cached_tokens}`, false],
    ["Cache Write", usage.cache_write_tokens === null ? "—" : String(usage.cache_write_tokens), `Cache Write：${usage.cache_write_tokens ?? "未知"}`, false],
    ["Cache Hit Rate", formatRatio(usage.cache_hit_rate).text, `Cache Hit Rate：${formatRatio(usage.cache_hit_rate).accessibleName}`, false],
  ] as const;

  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value, ariaLabel, emphasized]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className={emphasized ? "font-semibold text-foreground" : "text-muted-foreground"}>{label}</dt>
          <dd className={emphasized ? "font-semibold" : undefined}>
            <StaticValue value={value} ariaLabel={ariaLabel} />
          </dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4">
        <dt className="font-semibold text-foreground">Estimated Cost</dt>
        <dd className="font-semibold tabular-nums text-foreground">
          <CostValue value={usage.estimated_cost} status={usage.estimated_cost_status} />
        </dd>
      </div>
    </dl>
  );
}

function MainReceipt({ item }: { item: MainModelUsageDto }) {
  return <UsageReceipt usage={item.usage} />;
}

function SubagentReceipt({ item, timezone }: { item: SubagentDetailDto; timezone: string }) {
  const time = formatSessionTime(item.last_activity_at_ms, timezone);
  const model = formatModelWithReasoningEffort(item.model, item.reasoning_effort, item.reasoning_effort_mixed);
  return (
    <div>
      <dl className="space-y-2 text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
          <dt className="text-muted-foreground">Thread ID</dt>
          <dd className="min-w-0 max-w-64 truncate text-right tabular-nums text-foreground">
            <Tooltip content={item.thread_id} side="top" wrapperClassName="max-w-full">
              <span className="block truncate">{item.thread_id}</span>
            </Tooltip>
          </dd>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="max-w-64 truncate text-right text-foreground" title={model}>{model}</dd>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
          <dt className="text-muted-foreground">Last Active</dt>
          <dd className="text-right tabular-nums text-foreground" title={time.title}>{time.text}</dd>
        </div>
      </dl>
      <div className="my-4 border-t border-dashed border-border-strong" />
      <UsageReceipt usage={item.usage} />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Session 详情加载中" className="space-y-6">
      <div className="space-y-3 border-y border-dashed border-border-strong py-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex justify-between gap-4">
            <span className="h-3 w-28 animate-pulse rounded bg-muted" />
            <span className="h-4 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-14 animate-pulse rounded-[28px] bg-muted" />
      <div className="h-14 animate-pulse rounded-[28px] bg-muted" />
    </div>
  );
}

function SummaryReceipt({ detail }: { detail: SessionDetailResponse }) {
  const mainTokens = detail.main.self_usage.total_tokens;
  const totalTokens = detail.main.inclusive_usage.total_tokens;
  const subagentTokens = Math.max(0, totalTokens - mainTokens);
  const rows = [
    ["Main Tokens", mainTokens, false],
    ["Subagent Tokens", subagentTokens, false],
    ["Total Tokens", totalTokens, true],
  ] as const;

  return (
    <section aria-label="Session 合计" className="border-y border-dashed border-border-strong py-4">
      <dl className="space-y-2.5 text-sm">
        {rows.map(([label, value, emphasized]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className={emphasized ? "font-semibold text-foreground" : "text-muted-foreground"}>{label}</dt>
            <dd className={emphasized ? "font-semibold text-foreground" : "text-foreground"}>
              <NumberTicker value={value} locale blur className="tabular-nums" />
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-semibold text-foreground">Estimated Cost</dt>
          <dd className="font-semibold text-foreground">
            <CostValue value={detail.main.inclusive_usage.estimated_cost} status={detail.main.inclusive_usage.estimated_cost_status} ticker />
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function SessionDetailDrawer({ view, timezone }: SessionDetailDrawerProps) {
  const toast = useAnimatedToastStack();
  const [mainOpen, setMainOpen] = useState<string | null>(null);
  const [subagentOpen, setSubagentOpen] = useState<string | null>(null);
  const previousRefreshError = useRef<string | undefined>(undefined);
  const detail = view.detail;

  useEffect(() => {
    setMainOpen(null);
    setSubagentOpen(null);
  }, [view.selected_root_session_id]);

  useEffect(() => {
    if (view.refresh_error_code && view.refresh_error_code !== previousRefreshError.current) {
      toast.showToast({ status: "error", title: "详情更新失败" });
    }
    previousRefreshError.current = view.refresh_error_code;
  }, [view.refresh_error_code, toast.showToast]);

  const mainItems = useMemo(
    () => (detail?.main.model_usage ?? []).map((item, index) => ({
      id: `${item.model}:${item.reasoning_effort ?? "unknown"}:${index}`,
      title: formatModelWithReasoningEffort(item.model, item.reasoning_effort, false),
      description: <MainReceipt item={item} />,
    })),
    [detail],
  );

  const subagentItems = useMemo(
    () => (detail?.subagents ?? []).map((item) => ({
      id: item.thread_id,
      title: (
        <Tooltip content={formatSessionTitle(item.title)} side="top" wrapperClassName="max-w-full">
          <span className="block truncate">{formatSessionTitle(item.title)}</span>
        </Tooltip>
      ),
      description: <SubagentReceipt item={item} timezone={timezone} />,
    })),
    [detail, timezone],
  );

  if (!view.selected_row && !view.open) return null;

  const selected = view.selected_row;
  const title = formatSessionTitle(detail?.main.title ?? selected?.title ?? null);
  const timeValue = detail?.last_activity_at_ms ?? selected?.last_activity_at_ms ?? 0;
  const time = formatSessionTime(timeValue, timezone);
  const refreshing = view.load_state === "refreshing";

  return (
    <>
      <Drawer
        open={view.open}
        onOpenChange={(open) => { if (!open) view.close_detail(); }}
        side="right"
        ariaLabel="Session 详情"
        className="w-[480px] max-w-full max-[480px]:w-screen"
      >
        <div className="flex h-full min-w-0 flex-col overflow-hidden" aria-busy={view.load_state === "loading" || refreshing}>
          <header className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div className="min-w-0 flex-1">
              <Tooltip content={title} side="bottom" wrapperClassName="max-w-full">
                <h2 id="session-detail-title" className="m-0 block truncate text-base font-semibold leading-6 text-foreground">{title}</h2>
              </Tooltip>
              <Tooltip content={selected?.root_session_id ?? ""} side="bottom" wrapperClassName="max-w-full">
                <p className="mt-1 truncate text-[10px] leading-4 text-muted-foreground">{selected?.root_session_id ?? ""}</p>
              </Tooltip>
              <time className="mt-0.5 block text-[10px] leading-4 text-muted-foreground" dateTime={timeValue > 0 ? new Date(timeValue).toISOString() : undefined} title={time.title}>{time.text}</time>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip content="刷新当前详情" side="bottom">
                <Button variant="ghost" size="icon" aria-label="刷新当前详情" disabled={refreshing || !detail} onClick={view.refresh_detail}>
                  <ActionSwapIcon value={refreshing ? "loading" : "idle"} animation="blur" className="h-4 w-4">
                    {refreshing ? <Loader label="详情更新中" /> : <RefreshCw className="h-4 w-4" />}
                  </ActionSwapIcon>
                </Button>
              </Tooltip>
              <Tooltip content="关闭" side="bottom">
                <Button variant="ghost" size="icon" aria-label="关闭 Session 详情" onClick={view.close_detail}><X className="h-4 w-4" /></Button>
              </Tooltip>
            </div>
          </header>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
            {view.load_state === "loading" && !detail ? <DetailSkeleton /> : null}
            {view.load_state === "error" && !detail ? (
              <div className="rounded-2xl border border-destructive/20 p-5 text-center" role="alert">
                <p className="m-0 text-xs text-destructive">Session 详情加载失败</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={view.retry_detail}>重试</Button>
              </div>
            ) : null}
            {detail ? (
              <div className="space-y-6">
                <SummaryReceipt detail={detail} />

                <section aria-labelledby="drawer-main-heading">
                  <h3 id="drawer-main-heading" className="mb-3 text-sm font-semibold text-foreground">Main ({mainItems.length})</h3>
                  <BouncyAccordion
                    items={mainItems}
                    value={mainOpen}
                    onValueChange={setMainOpen}
                    classNames={{ description: "text-foreground" }}
                  />
                </section>

                <section aria-labelledby="drawer-subagent-heading">
                  <h3 id="drawer-subagent-heading" className="mb-3 text-sm font-semibold text-foreground">Subagent ({subagentItems.length})</h3>
                  {subagentItems.length > 0 ? (
                    <BouncyAccordion
                      items={subagentItems}
                      value={subagentOpen}
                      onValueChange={setSubagentOpen}
                      classNames={{ description: "text-foreground" }}
                    />
                  ) : (
                    <p className="m-0 rounded-xl border border-border p-4 text-xs text-muted-foreground">暂无 Subagent</p>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </Drawer>
      <AnimatedToastStack toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </>
  );
}
