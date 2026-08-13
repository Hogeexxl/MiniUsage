import { useEffect, useRef, useState } from "react";

import type { SessionDetailResponse, SubagentDetailDto, UsageDto } from "../../data/types";
import { formatCost, formatRatio } from "../format";
import {
  formatModelWithReasoningEffort,
  formatSessionTime,
  formatSessionTitle,
  formatSessionTokenInteger,
  formatSessionNullableTokenInteger,
} from "./sessionFormat";
import type { SessionDetailControllerViewModel } from "./useSessionDetailController";

type SessionDetailDrawerProps = {
  view: SessionDetailControllerViewModel;
  timezone: string;
};

const usageFields = [
  ["总 Token", "total_tokens"],
  ["输入 Token", "input_tokens"],
  ["输出 Token", "output_tokens"],
  ["推理 Token", "reasoning_tokens"],
  ["缓存命中率", "cache_hit_rate"],
  ["缓存读取", "cached_tokens"],
  ["缓存写入", "cache_write_tokens"],
  ["预估费用", "estimated_cost"],
] as const;

function usageValue(usage: UsageDto, field: (typeof usageFields)[number][1]) {
  if (field === "cache_hit_rate") return formatRatio(usage.cache_hit_rate);
  if (field === "estimated_cost") return formatCost(usage.estimated_cost);
  if (field === "cache_write_tokens") return formatSessionNullableTokenInteger(usage.cache_write_tokens);
  return formatSessionTokenInteger(usage[field]);
}

function UsageGrid({ usage }: { usage: UsageDto }) {
  return (
    <dl className="session-detail-usage-grid">
      {usageFields.map(([label, field]) => {
        const value = usageValue(usage, field);
        return (
          <div className="session-detail-usage-item" key={field}>
            <dt>{label}</dt>
            <dd title={value.title} aria-label={`${label}：${value.accessibleName}`}>{value.text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function SkeletonUsage() {
  return (
    <div className="session-detail-skeleton-grid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <span className="session-detail-skeleton-line" key={index} />)}
    </div>
  );
}

function MainModelUsageBlock({ model, index, count }: { model: SessionDetailResponse["main"]["model_usage"][number]; index: number; count: number }) {
  return (
    <article className="session-detail-usage-block">
      <header className="session-detail-usage-block-header">
        <h4>{formatModelWithReasoningEffort(model.model, model.reasoning_effort, false)}</h4>
        <span>模型 {index + 1} / {count}</span>
      </header>
      <UsageGrid usage={model.usage} />
    </article>
  );
}

function SubagentUsageBlock({
  subagent,
  expanded,
  onToggle,
  timezone,
}: {
  subagent: SubagentDetailDto;
  expanded: boolean;
  onToggle: () => void;
  timezone: string;
}) {
  const title = formatSessionTitle(subagent.title);
  const time = formatSessionTime(subagent.last_activity_at_ms, timezone);
  return (
    <article className={`session-detail-subagent-block${expanded ? " is-expanded" : ""}`}>
      <header className="session-detail-subagent-header">
        <button
          type="button"
          className="session-detail-subagent-toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"} Subagent 详情`}
          onClick={onToggle}
        >
          <span aria-hidden="true" className="session-detail-chevron">›</span>
        </button>
        <div className="session-detail-subagent-identity">
          <h4 title={title}>{title}</h4>
          <p className="session-detail-subagent-id" title={subagent.thread_id}>{subagent.thread_id}</p>
        </div>
        <div className="session-detail-subagent-right-meta">
          <span className="session-detail-subagent-model">
            {formatModelWithReasoningEffort(subagent.model, subagent.reasoning_effort, subagent.reasoning_effort_mixed)}
          </span>
          <time className="session-detail-subagent-time" dateTime={new Date(subagent.last_activity_at_ms).toISOString()} title={time.title}>{time.text}</time>
        </div>
      </header>
      {expanded ? <div className="session-detail-subagent-content"><UsageGrid usage={subagent.usage} /></div> : null}
    </article>
  );
}

function DetailSkeleton() {
  return (
    <div className="session-detail-skeleton" role="status" aria-label="Session 详情加载中">
      <div className="session-detail-skeleton-summary"><span /><span /><span /><span /></div>
      <span className="session-detail-skeleton-heading" />
      <div className="session-detail-skeleton-block"><SkeletonUsage /></div>
      <span className="session-detail-skeleton-heading" />
      <div className="session-detail-skeleton-block"><SkeletonUsage /></div>
    </div>
  );
}

export function SessionDetailDrawer({ view, timezone }: SessionDetailDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [expandedSubagents, setExpandedSubagents] = useState<Set<string>>(new Set());
  const detailKey = view.detail ? `${view.detail.root_session_id}:${view.detail.data_revision}` : null;

  useEffect(() => {
    if (!view.open) return undefined;
    const detail = view.detail;
    const first = detail?.subagents[0]?.thread_id;
    setExpandedSubagents(first ? new Set([first]) : new Set());
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        view.close_detail();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) return;
      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [detailKey, view.close_detail, view.open]);

  if (!view.open || !view.selected_row) return null;

  const detail = view.detail;
  const title = formatSessionTitle(detail?.main.title ?? view.selected_row.title);
  const timeValue = detail?.last_activity_at_ms ?? view.selected_row.last_activity_at_ms;
  const time = formatSessionTime(timeValue, timezone);
  const summaryInclusive = detail?.main.inclusive_usage;
  const summaryMain = detail?.main.self_usage;
  const summarySubagent = detail
    ? {
        ...detail.main.self_usage,
        total_tokens: detail.main.inclusive_usage.total_tokens - detail.main.self_usage.total_tokens,
      }
    : null;
  const summaryCost = summaryInclusive
    ? summaryInclusive.estimated_cost_status === "unknown"
      ? formatCost(null)
      : formatCost(summaryInclusive.estimated_cost)
    : null;
  const toggleSubagent = (threadId: string) => {
    setExpandedSubagents((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  return (
    <div className="session-detail-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) view.close_detail(); }}>
      <div
        ref={drawerRef}
        className="session-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-detail-title"
        aria-busy={view.load_state === "loading" || view.load_state === "refreshing"}
      >
        <header className="session-detail-header">
          <div className="session-detail-heading">
            <h2 id="session-detail-title">{title}</h2>
            <div className="session-detail-id-line">
              <span className="session-detail-id" title={view.selected_row.root_session_id}>{view.selected_row.root_session_id}</span>
            </div>
            <div className="session-detail-time-line">
              <time dateTime={new Date(timeValue).toISOString()} title={time.title}>{time.text}</time>
              {view.load_state === "refreshing" ? <span className="session-detail-refreshing" role="status">正在更新 <span className="session-detail-spinner" aria-hidden="true" /></span> : null}
            </div>
          </div>
          <div className="session-detail-header-actions">
            <button type="button" className="session-detail-refresh-button" aria-label="刷新当前详情" onClick={view.refresh_detail}>刷新</button>
            <button ref={closeButtonRef} type="button" className="session-detail-close-button" aria-label="关闭 Session 详情" onClick={view.close_detail}>关闭</button>
          </div>
        </header>

        <div className="session-detail-body">
          {view.refresh_error_code ? <div className="session-detail-refresh-error" role="alert">详情更新失败 <button type="button" className="retry-button" onClick={view.retry_detail}>重试</button></div> : null}
          {view.load_state === "loading" && !detail ? <DetailSkeleton /> : null}
          {view.load_state === "error" && !detail ? (
            <div className="session-detail-error" role="alert">
              <p>Session 详情加载失败</p>
              <button type="button" className="retry-button" onClick={view.retry_detail}>重试</button>
            </div>
          ) : null}
          {detail ? (
            <>
              <section className="session-detail-summary" aria-label="Session 合计">
                <div className="session-detail-summary-total"><span>合计 Token</span><strong>{formatSessionTokenInteger(summaryInclusive!.total_tokens).text}</strong></div>
                <div><span>Main</span><strong>{formatSessionTokenInteger(summaryMain!.total_tokens).text}</strong></div>
                <div><span>Subagent</span><strong>{formatSessionTokenInteger(summarySubagent!.total_tokens).text}</strong></div>
                <div className="session-detail-summary-cost-item"><span>合计费用</span><strong className={`session-detail-summary-cost session-cost-cell${summaryInclusive!.estimated_cost_status === "partial" ? " is-partial" : ""}`}>{summaryCost!.text}</strong></div>
              </section>
              <section className="session-detail-section" aria-labelledby="session-detail-main-heading">
                <div className="session-detail-section-heading"><h3 id="session-detail-main-heading">Main <span>({detail.main.model_usage.length})</span></h3></div>
                {detail.main.model_usage.map((model, index) => <MainModelUsageBlock key={`${model.model}:${index}`} model={model} index={index} count={detail.main.model_usage.length} />)}
              </section>
              <section className="session-detail-section" aria-labelledby="session-detail-subagent-heading">
                <div className="session-detail-section-heading"><h3 id="session-detail-subagent-heading">Subagent <span>({detail.subagents.length})</span></h3></div>
                <div className="session-detail-subagents">
                  {detail.subagents.length === 0 ? <p className="session-detail-empty">暂无 Subagent</p> : detail.subagents.map((subagent) => <SubagentUsageBlock key={subagent.thread_id} subagent={subagent} expanded={expandedSubagents.has(subagent.thread_id)} onToggle={() => toggleSubagent(subagent.thread_id)} timezone={timezone} />)}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
