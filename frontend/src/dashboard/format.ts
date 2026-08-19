export type FormattedValue = {
  text: string;
  title: string;
  accessibleName: string;
};

function finiteInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Expected a non-negative safe integer");
  return value;
}

function finiteNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Expected a non-negative finite number");
  return value;
}

function compact(value: number, fractionDigits = 1): string {
  const units = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ] as const;
  const match = units.find(([unit]) => value >= unit);
  if (!match) return Number.isInteger(value) ? String(value) : value.toFixed(fractionDigits).replace(/\.0+$/, "");
  const [divisor, suffix] = match;
  return `${(value / divisor).toFixed(fractionDigits).replace(/\.0+$/, "")}${suffix}`;
}

export function formatCompact(value: number): string {
  return compact(finiteInteger(value), 1);
}

export function formatCompactCost(value: number): string {
  const cost = finiteNonNegative(value);
  return cost >= 1_000 ? `$${compact(cost, 2)}` : `$${cost.toFixed(2)}`;
}

export function formatInteger(value: number | null): FormattedValue {
  if (value === null) return { text: "—", title: "未知", accessibleName: "未知" };
  const integer = finiteInteger(value);
  const full = String(integer);
  return { text: formatCompact(integer), title: full, accessibleName: full };
}

export function formatRatio(value: number | null): FormattedValue {
  if (value === null) return { text: "—", title: "未知", accessibleName: "未知" };
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Expected a ratio between 0 and 1");
  const percent = `${(value * 100).toFixed(1)}%`;
  return { text: percent, title: percent, accessibleName: percent };
}

export function formatCost(value: number | null): FormattedValue {
  if (value === null) return { text: "—", title: "未知", accessibleName: "未知" };
  const text = formatCompactCost(value);
  const full = `$${finiteNonNegative(value).toFixed(2)}`;
  return { text, title: full, accessibleName: full };
}

export function formatLastSyncTime(value: number | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}
