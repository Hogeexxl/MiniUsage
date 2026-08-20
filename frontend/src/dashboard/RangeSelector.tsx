import { RANGE_KEYS, type RangeKey } from "../data/types";
import { Tabs, TabsList, TabsTrigger } from "../ui/beui/tabs";

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "今天",
  yesterday: "昨天",
  "7d": "7d",
  "30d": "30d",
  year: "今年",
};

type RangeSelectorProps = {
  value: RangeKey;
  onChange: (range: RangeKey) => void;
};

export function RangeSelector({ value, onChange }: RangeSelectorProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(range) => onChange(range as RangeKey)}
      variant="pill"
    >
      <TabsList>
        {RANGE_KEYS.map((range) => (
          <TabsTrigger key={range} value={range}>
            {RANGE_LABELS[range]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
