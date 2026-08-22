import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { DateRange } from "react-day-picker";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import type { DashboardRange } from "../data/types";
import { Calendar } from "../ui/shadcn/calendar";
import { Popover, PopoverContent } from "../ui/shadcn/popover";

type CustomDateRangePickerProps = {
  open: boolean;
  value: DashboardRange;
  onChange: (range: Extract<DashboardRange, { key: "custom" }>) => void;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
};

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function selectedRange(value: DashboardRange): DateRange | undefined {
  return value.key === "custom" ? { from: parseDate(value.from), to: parseDate(value.to) } : undefined;
}

export function CustomDateRangePicker({
  open,
  value,
  onChange,
  onOpenChange,
  trigger,
}: CustomDateRangePickerProps) {
  const [draft, setDraft] = useState<DateRange | undefined>(() => selectedRange(value));

  useEffect(() => {
    if (open) setDraft(selectedRange(value));
  }, [open, value]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setDraft(selectedRange(value));
      onOpenChange(nextOpen);
    },
    [onOpenChange, value],
  );

  const handleSelect = (next: DateRange | undefined) => {
    setDraft(next);
    if (!next?.from || !next.to) return;

    onChange({
      key: "custom",
      from: formatDate(next.from),
      to: formatDate(next.to),
    });
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <PopoverPrimitive.Anchor asChild>
          <span className="inline-flex" onClick={() => onOpenChange(true)}>
            {trigger}
          </span>
        </PopoverPrimitive.Anchor>
      ) : null}
      <PopoverContent className="w-auto p-0" align="start" aria-label="自定义日期范围">
        <Calendar
          mode="range"
          defaultMonth={draft?.from ?? new Date()}
          selected={draft}
          onSelect={handleSelect}
          numberOfMonths={2}
          resetOnSelect
        />
      </PopoverContent>
    </Popover>
  );
}
