import { useMemo, useState } from "react";
import { buildDistribution, type DistributionItem, type DistributionMetric } from "./distribution";

const PALETTE = ["#5576d9", "#5aa888", "#d08a4b", "#986fc1", "#d85d75", "#5c9eb4", "#9b9b63"];

function colorFor(id: string, index: number) {
  if (id === "__other__") return "#a4a8b0";
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[(hash + index) % PALETTE.length];
}

function formatValue(metric: DistributionMetric, value: number) {
  if (metric === "cost") return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  return new Intl.NumberFormat("zh-CN", { notation: value >= 100000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export function DistributionDonutCard({ title, items }: { title: string; items: DistributionItem[] }) {
  const [metric, setMetric] = useState<DistributionMetric>("tokens");
  const data = useMemo(() => buildDistribution(items, metric), [items, metric]);
  let offset = 0;
  return (
    <article className="chart-card distribution-card">
      <header className="chart-card-header">
        <h2>{title}</h2>
        <div className="chart-segmented" aria-label={`${title}统计口径`}>
          <button type="button" className={metric === "tokens" ? "active" : ""} onClick={() => setMetric("tokens")}>Token</button>
          <button type="button" className={metric === "cost" ? "active" : ""} onClick={() => setMetric("cost")}>费用</button>
        </div>
      </header>
      <div className="distribution-body">
        <div className="donut-wrap">
          <svg className="donut-chart" viewBox="0 0 120 120" role="img" aria-label={`${title}${metric === "tokens" ? "Token" : "费用"}分布`}>
            <circle className="donut-track" cx="60" cy="60" r="48" pathLength="100" />
            {data.segments.filter((segment) => segment.percentage > 0).map((segment, index) => {
              const percent = segment.percentage * 100;
              const current = offset;
              offset += percent;
              return <circle key={segment.id} className="donut-segment" cx="60" cy="60" r="48" pathLength="100"
                style={{ stroke: colorFor(segment.id, index), strokeDasharray: `${percent} ${100 - percent}`, strokeDashoffset: -current }} />;
            })}
          </svg>
          <div className="donut-center"><strong>{formatValue(metric, data.total)}</strong><span>{metric === "tokens" ? "Token" : "已知费用"}</span></div>
        </div>
        <div className="distribution-legend">
          {data.segments.map((segment, index) => (
            <div className="legend-row" key={segment.id} title={segment.title}>
              <span className="legend-dot" style={{ background: colorFor(segment.id, index) }} />
              <span className="legend-name">{segment.label}</span>
              <span className="legend-value">{formatValue(metric, segment.value)}</span>
              <span className="legend-percent">{(segment.percentage * 100).toFixed(1)}%</span>
            </div>
          ))}
          {metric === "cost" && data.unknown.map((item, index) => (
            <div className="legend-row legend-unknown" key={item.id} title={item.title}>
              <span className="legend-dot" style={{ background: colorFor(item.id, index + data.segments.length) }} />
              <span className="legend-name">{item.label}</span><span className="legend-value">—</span><span className="legend-percent">—</span>
            </div>
          ))}
          {data.segments.length === 0 && data.unknown.length === 0 ? <div className="chart-empty">暂无数据</div> : null}
        </div>
      </div>
    </article>
  );
}
