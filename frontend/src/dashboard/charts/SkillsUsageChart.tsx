import { useMemo, useState } from "react";
import type { SkillsUsageResponse } from "../../data/types";

const PALETTE = ["#5576d9", "#5aa888", "#d08a4b", "#986fc1", "#d85d75", "#5c9eb4", "#9b9b63", "#bf6d4d"];
function colorFor(name: string, index: number) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[(hash + index) % PALETTE.length];
}

export function SkillsUsageChart({ response }: { response: SkillsUsageResponse | null }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const data = useMemo(() => {
    const days = response?.days ?? [];
    const skills = [...new Set(days.flatMap((day) => day.skills.map((skill) => skill.skill_name)))].sort();
    const counts = skills.map((name) => days.map((day) => day.skills.find((skill) => skill.skill_name === name)?.count ?? 0));
    return { days, skills, counts, max: Math.max(1, ...days.map((day) => day.total)) };
  }, [response]);
  if (response?.data_status === "rebuilding") {
    return <article className="chart-card skills-card"><header className="chart-card-header"><h2>Skills 用量</h2><span className="chart-note">最近 7 天</span></header><div className="chart-empty">Skills 数据同步中…</div></article>;
  }
  const width = 760, height = 260, left = 42, right = 18, top = 18, bottom = 38;
  const plotW = width - left - right, plotH = height - top - bottom;
  const x = (index: number) => left + (data.days.length <= 1 ? 0 : (index * plotW) / (data.days.length - 1));
  const y = (value: number) => top + plotH - (value / data.max) * plotH;
  const lower = Array(data.days.length).fill(0) as number[];
  const areas = data.skills.map((skill, skillIndex) => {
    const upper = lower.map((value, dayIndex) => value + data.counts[skillIndex][dayIndex]);
    const topPath = upper.map((value, dayIndex) => `${dayIndex === 0 ? "M" : "L"}${x(dayIndex)},${y(value)}`).join(" ");
    const bottomPath = lower.map((value, dayIndex) => [dayIndex, value] as const).reverse().map(([dayIndex, value]) => `L${x(dayIndex)},${y(value)}`).join(" ");
    const path = `${topPath} ${bottomPath} Z`;
    lower.splice(0, lower.length, ...upper);
    return { skill, path, color: colorFor(skill, skillIndex) };
  });
  const hoverDay = hovered === null ? null : data.days[hovered];
  return (
    <article className="chart-card skills-card">
      <header className="chart-card-header"><h2>Skills 用量</h2><span className="chart-note">最近 7 个自然日</span></header>
      {data.days.length === 7 ? <div className="skills-chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} className="skills-chart" role="img" aria-label="最近 7 天 Skills 使用次数">
          <line x1={left} y1={top + plotH} x2={width - right} y2={top + plotH} className="chart-axis" />
          {areas.map((area) => <path key={area.skill} d={area.path} fill={area.color} fillOpacity="0.72" />)}
          {data.days.map((day, index) => <g key={day.date}>
            <text x={x(index)} y={height - 14} textAnchor="middle" className="chart-label">{day.date.slice(5)}</text>
            <rect x={Math.max(left, x(index) - plotW / 14)} y={top} width={plotW / 7} height={plotH} fill="transparent"
              onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} />
          </g>)}
          {hovered !== null ? <line x1={x(hovered)} y1={top} x2={x(hovered)} y2={top + plotH} className="chart-hover-line" /> : null}
        </svg>
        {hoverDay ? <div className="skills-tooltip"><strong>{hoverDay.date}</strong><span>合计 {hoverDay.total} 次</span>{[...hoverDay.skills].sort((a,b) => b.count-a.count || a.skill_name.localeCompare(b.skill_name)).map((skill) => <span key={skill.skill_name}>{skill.skill_name} × {skill.count}</span>)}</div> : null}
        <div className="skills-legend">{data.skills.map((skill, index) => <span key={skill}><i style={{ background: colorFor(skill, index) }} />{skill}</span>)}</div>
      </div> : <div className="chart-empty">暂无 Skills 数据</div>}
    </article>
  );
}
