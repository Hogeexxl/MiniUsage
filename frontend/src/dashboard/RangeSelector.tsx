import { useCallback, useState } from "react";

import { RANGE_KEYS, type DashboardRange, type PresetRangeKey } from "../data/types";
import { Tabs, TabsList, TabsTrigger } from "../ui/beui/tabs";
import { CustomDateRangePicker } from "./CustomDateRangePicker";

const RANGE_LABELS: Record<PresetRangeKey, string> = {
  today: "今天",
  yesterday: "昨天",
  "7d": "7d",
  "30d": "30d",
  year: "今年",
};

type RangeSelectorProps = {
  value: DashboardRange;
  onChange: (range: DashboardRange) => void;
};

export function RangeSelector({ value, onChange }: RangeSelectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const activeValue = value.key;
  const handleValueChange = useCallback(
    (range: string) => {
      if (range === "custom") return;
      setPickerOpen(false);
      onChange({ key: range as PresetRangeKey });
    },
    [onChange],
  );
  return (
    <Tabs value={activeValue} onValueChange={handleValueChange} variant="pill">
      <TabsList>
        {RANGE_KEYS.map((range) => (
          <TabsTrigger key={range} value={range}>
            {RANGE_LABELS[range]}
          </TabsTrigger>
        ))}
        <CustomDateRangePicker
          open={pickerOpen}
          value={value}
          onChange={(range) => {
            setPickerOpen(false);
            onChange(range);
          }}
          onOpenChange={setPickerOpen}
          trigger={<TabsTrigger value="custom">自定义</TabsTrigger>}
        />
      </TabsList>
    </Tabs>
  );
}
