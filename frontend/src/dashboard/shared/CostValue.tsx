import { CircleAlert } from "lucide-react";
import type { EstimatedCostStatus } from "../../data/types";
import { NumberTicker } from "../../ui/beui/number-ticker";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/beui/popover";
import { formatCompactCost } from "../format";

export function CostValue({ value, status, ticker = false, className }: { value: number | null; status: EstimatedCostStatus; ticker?: boolean; className?: string }) {
  const text = value === null ? "—" : formatCompactCost(value);
  const valueNode = value === null
    ? <span className={className}>—</span>
    : ticker
      ? <span title={`$${value.toFixed(2)}`}><NumberTicker value={Math.round(value * 100)} blur format={(next) => formatCompactCost(next / 100)} className={className} /></span>
      : <span className={className} title={`$${value.toFixed(2)}`}>{text}</span>;
  if (status === "complete") return valueNode;
  const message = status === "partial" ? "有部分费用不完整" : "当前费用无法完整估算";
  return <span className="inline-flex items-center justify-end gap-1.5">{valueNode}<Popover><PopoverTrigger><button type="button" aria-label="费用完整性提示" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"><CircleAlert className="h-3.5 w-3.5" /></button></PopoverTrigger><PopoverContent className="w-max max-w-64 text-xs">{message}</PopoverContent></Popover></span>;
}
