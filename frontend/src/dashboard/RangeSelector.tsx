import { RANGE_KEYS, type RangeKey } from "../data/types";

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "今天",
  yesterday: "昨天",
  week: "本周",
  month: "本月",
  year: "今年",
};

type RangeSelectorProps = {
  value: RangeKey;
  onChange: (range: RangeKey) => void;
};

export function RangeSelector({ value, onChange }: RangeSelectorProps) {
  return (
    <div className="range-selector" role="group" aria-label="时间范围">
      {RANGE_KEYS.map((range) => (
        <button
          key={range}
          type="button"
          className={`range-option${value === range ? " is-selected" : ""}`}
          aria-pressed={value === range}
          onClick={() => onChange(range)}
        >
          {RANGE_LABELS[range]}
        </button>
      ))}
    </div>
  );
}
