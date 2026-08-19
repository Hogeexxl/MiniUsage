import { describe, expect, it } from "vitest";

import type { SkillDayDto } from "../../data/types";
import { buildSkillSeries, niceScale } from "./skillSeries";

function day(date: string, skills: Array<[string, number]>): SkillDayDto {
  const total = skills.reduce((sum, [, count]) => sum + count, 0);
  return {
    date,
    start_ms: 0,
    end_ms: 1,
    total,
    skills: skills.map(([skill_name, count]) => ({ skill_name, count })),
  };
}

describe("Skills chart data", () => {
  it("ranks by the fixed seven-day total and folds ranks after Top 10 into Other", () => {
    const days = Array.from({ length: 7 }, (_, dayIndex) =>
      day(
        `2026-08-${String(dayIndex + 1).padStart(2, "0")}`,
        Array.from({ length: 12 }, (_, skillIndex) => [`skill-${String(skillIndex + 1).padStart(2, "0")}`, 12 - skillIndex] as [string, number]),
      ),
    );
    const result = buildSkillSeries(days);
    expect(result.days).toHaveLength(7);
    expect(result.series).toHaveLength(11);
    expect(result.series.slice(0, 3).map((series) => series.label)).toEqual(["skill-01", "skill-02", "skill-03"]);
    expect(result.series.at(-1)).toMatchObject({ id: "__other__", label: "其他", isOther: true });
    expect(result.series.at(-1)?.counts).toEqual(Array(7).fill(3));
    expect(result.total).toBe(days.reduce((sum, entry) => sum + entry.total, 0));
  });

  it("uses stable name ordering for equal totals", () => {
    const result = buildSkillSeries([
      day("2026-08-01", [["zeta", 1], ["alpha", 1]]),
      ...Array.from({ length: 6 }, (_, index) => day(`2026-08-0${index + 2}`, [])),
    ]);
    expect(result.series.map((series) => series.label)).toEqual(["alpha", "zeta"]);
  });

  it.each([
    [0, { max: 1, step: 1, ticks: [0, 1] }],
    [4, { max: 4, step: 1, ticks: [0, 1, 2, 3, 4] }],
    [8, { max: 8, step: 2, ticks: [0, 2, 4, 6, 8] }],
    [21, { max: 40, step: 10, ticks: [0, 10, 20, 30, 40] }],
    [240, { max: 400, step: 100, ticks: [0, 100, 200, 300, 400] }],
  ])("builds a 1/2/5 × 10^n nice scale for peak %s", (peak, expected) => {
    expect(niceScale(peak)).toEqual(expected);
  });
});
