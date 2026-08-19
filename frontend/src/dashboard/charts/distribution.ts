import type { EstimatedCostStatus } from "../../data/types";

export type DistributionMetric = "tokens" | "cost";
export type DistributionItem = {
  id: string;
  label: string;
  totalTokens: number;
  estimatedCost: number | null;
  estimatedCostStatus: EstimatedCostStatus;
  title?: string;
};
export type DistributionSegment = DistributionItem & { value: number; percentage: number; isOther?: boolean };

export function buildDistribution(items: DistributionItem[], metric: DistributionMetric) {
  const eligible = metric === "tokens" ? items : items.filter((item) => item.estimatedCost !== null);
  const valueOf = (item: DistributionItem) => metric === "tokens" ? item.totalTokens : item.estimatedCost ?? 0;
  const sorted = [...eligible].sort((a, b) => valueOf(b) - valueOf(a) || a.label.localeCompare(b.label));
  const total = sorted.reduce((sum, item) => sum + valueOf(item), 0);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  const visible: Array<DistributionItem & { value: number; isOther?: boolean }> = top.map((item) => ({ ...item, value: valueOf(item) }));
  if (rest.length > 0) {
    visible.push({
      id: "__other__",
      label: "其他",
      totalTokens: rest.reduce((sum, item) => sum + item.totalTokens, 0),
      estimatedCost: metric === "cost" ? rest.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0) : null,
      estimatedCostStatus: rest.some((item) => item.estimatedCostStatus === "partial") ? "partial" : "complete",
      value: rest.reduce((sum, item) => sum + valueOf(item), 0),
      isOther: true,
    });
  }
  const segments: DistributionSegment[] = visible.map((item) => ({ ...item, percentage: total > 0 ? item.value / total : 0 }));
  return { total, segments };
}
