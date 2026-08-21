const CHART_SERIES_COLORS = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
  "var(--chart-series-5)",
  "var(--chart-series-6)",
  "var(--chart-series-7)",
  "var(--chart-series-8)",
  "var(--chart-series-9)",
  "var(--chart-series-10)",
] as const;

export function chartSeriesColor(index: number, isOther = false): string {
  if (isOther) return "var(--chart-other)";
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
}

export const chartMuted = "var(--border-strong)";
