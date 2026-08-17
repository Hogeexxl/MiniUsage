import { useEffect, useRef, useState } from "react";

import type { SummaryUsageDto } from "../data/types";
import { formatCost, formatInteger, formatRatio, type FormattedValue } from "./format";
import { MetricCard } from "./MetricCard";

const METRIC_DEFINITIONS = [
  { key: "estimated_cost", label: "预估费用" },
  { key: "total_tokens", label: "总 Token" },
  { key: "input_tokens", label: "输入 Token" },
  { key: "output_tokens", label: "输出 Token" },
  { key: "session_count", label: "会话数量" },
  { key: "cache_hit_rate", label: "缓存命中率" },
  { key: "cached_tokens", label: "缓存读取 Token" },
  { key: "reasoning_tokens", label: "推理 Token" },
] as const;

function metricValue(usage: SummaryUsageDto, key: (typeof METRIC_DEFINITIONS)[number]["key"]): FormattedValue {
  switch (key) {
    case "estimated_cost":
      return formatCost(usage.estimated_cost);
    case "cache_hit_rate":
      return formatRatio(usage.cache_hit_rate);
    case "total_tokens":
    case "input_tokens":
    case "output_tokens":
    case "session_count":
    case "cached_tokens":
    case "reasoning_tokens":
      return formatInteger(usage[key]);
  }
}

function metricNotice(usage: SummaryUsageDto, key: (typeof METRIC_DEFINITIONS)[number]["key"]) {
  if (key === "total_tokens") {
    const { total_sessions: total, complete_sessions: complete, incomplete_sessions: incomplete, error_sessions: errors } = usage.session_health;
    if (errors > 0) {
      const suffix = incomplete > 0 ? `，${incomplete} 个不完整` : "";
      return {
        ariaLabel: "总 Token 数据完整性提示",
        message: `已计算 ${complete}/${total} 个 Session，${errors} 个异常未计入${suffix}`,
        severity: "error" as const,
      };
    }
    if (incomplete > 0) {
      return {
        ariaLabel: "总 Token 数据完整性提示",
        message: `已计算 ${complete}/${total} 个 Session，${incomplete} 个不完整`,
        severity: "warning" as const,
      };
    }
    return undefined;
  }
  if (key !== "estimated_cost" || usage.estimated_cost_status === "complete") return undefined;
  return {
    ariaLabel: "预估费用完整性提示",
    message: usage.estimated_cost_status === "partial" ? "有部分费用不完整" : "当前费用无法完整估算",
    severity: "warning" as const,
  };
}

type MetricGridProps = {
  usage: SummaryUsageDto | null;
  modelFilterActive: boolean;
};

export function MetricGrid({ usage, modelFilterActive }: MetricGridProps) {
  const visibleMetrics = METRIC_DEFINITIONS.filter(({ key }) => !modelFilterActive || key !== "session_count");
  const previousUsageRef = useRef<SummaryUsageDto | null>(usage);
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    const previousUsage = previousUsageRef.current;
    previousUsageRef.current = usage;
    if (usage === null || previousUsage === null || usage === previousUsage) {
      setUpdated(false);
      return;
    }
    setUpdated(true);
    const timer = window.setTimeout(() => setUpdated(false), 120);
    return () => window.clearTimeout(timer);
  }, [usage]);

  if (!usage) {
    return (
      <div className="metric-grid" aria-label="KPI 加载中">
        {visibleMetrics.map(({ key }) => (
          <div key={key} className="metric-card metric-skeleton" aria-hidden="true" />
        ))}
      </div>
    );
  }
  return (
    <div className="metric-grid" aria-label="KPI 指标">
      {visibleMetrics.map(({ key, label }) => (
        <MetricCard key={key} label={label} value={metricValue(usage, key)} updated={updated} notice={metricNotice(usage, key)} />
      ))}
    </div>
  );
}
