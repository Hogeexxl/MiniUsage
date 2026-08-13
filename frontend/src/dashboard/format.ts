export type FormattedValue = {
  text: string;
  title: string;
  accessibleName: string;
};

function finiteInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Expected a non-negative safe integer");
  }
  return value;
}

export function formatCompact(value: number): string {
  const integer = finiteInteger(value);
  if (integer < 1_000) return String(integer);
  const units = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ] as const;
  const [divisor, suffix] = units.find(([unit]) => integer >= unit) ?? [1, ""];
  const compact = (integer / divisor).toFixed(1).replace(/\.0$/, "");
  return `${compact}${suffix}`;
}

export function formatInteger(value: number | null): FormattedValue {
  if (value === null) {
    return { text: "—", title: "未知", accessibleName: "未知" };
  }
  const integer = finiteInteger(value);
  const full = String(integer);
  return { text: formatCompact(integer), title: full, accessibleName: full };
}

export function formatRatio(value: number | null): FormattedValue {
  if (value === null) {
    return { text: "—", title: "未知", accessibleName: "未知" };
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Expected a ratio between 0 and 1");
  }
  const percent = `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
  return { text: percent, title: percent, accessibleName: percent };
}

export function formatCost(value: number | null): FormattedValue {
  if (value === null) {
    return { text: "—", title: "未知", accessibleName: "未知" };
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Expected a non-negative cost");
  }
  const cost = `$${value.toFixed(2)}`;
  return { text: cost, title: cost, accessibleName: cost };
}

export function formatLastSyncTime(value: number | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
