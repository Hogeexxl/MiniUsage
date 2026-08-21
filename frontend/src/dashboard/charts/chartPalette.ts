const CHART_SERIES_COLORS = [
  "var(--chart-mint-a)",
  "var(--chart-peach-a)",
  "var(--chart-sky-a)",
  "var(--chart-lavender-a)",
  "var(--chart-butter-a)",
  "var(--chart-mint-b)",
  "var(--chart-peach-b)",
  "var(--chart-sky-b)",
  "var(--chart-lavender-b)",
  "var(--chart-butter-b)",
] as const;

export function chartSeriesColor(index: number, isOther = false): string {
  if (isOther) return "var(--chart-other)";
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
}

export const chartMuted = "var(--border-strong)";
