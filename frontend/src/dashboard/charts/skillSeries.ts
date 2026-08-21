import type { SkillDayDto } from "../../data/types";

export type SkillSeries = { id: string; label: string; counts: number[]; total: number; isOther?: boolean };

function skillLabel(skillKey: string) {
  return skillKey
    .split(":")
    .map((namespace) =>
      namespace
        .split("-")
        .map((word) => (word.length === 0 ? word : `${word[0].toUpperCase()}${word.slice(1)}`))
        .join(" "),
    )
    .join(": ");
}

export function buildSkillSeries(days: SkillDayDto[]) {
  const totals = new Map<string, number>();
  for (const day of days) for (const skill of day.skills) totals.set(skill.skill_name, (totals.get(skill.skill_name) ?? 0) + skill.count);
  const ranked = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topNames = ranked.slice(0, 10).map(([name]) => name);
  const otherNames = new Set(ranked.slice(10).map(([name]) => name));
  const series: SkillSeries[] = topNames.map((name) => {
    const counts = days.map((day) => day.skills.find((skill) => skill.skill_name === name)?.count ?? 0);
    return { id: name, label: skillLabel(name), counts, total: counts.reduce((sum, value) => sum + value, 0) };
  });
  if (otherNames.size > 0) {
    const counts = days.map((day) => day.skills.reduce((sum, skill) => sum + (otherNames.has(skill.skill_name) ? skill.count : 0), 0));
    series.push({ id: "__other__", label: "其他", counts, total: counts.reduce((sum, value) => sum + value, 0), isOther: true });
  }
  return { days, series, total: days.reduce((sum, day) => sum + day.total, 0) };
}

export function niceScale(peak: number, targetTicks = 4) {
  if (!Number.isFinite(peak) || peak <= 0) return { max: 1, step: 1, ticks: [0, 1] };
  const raw = peak / Math.max(1, targetTicks);
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = factor * power;
  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value);
  return { max, step, ticks };
}
