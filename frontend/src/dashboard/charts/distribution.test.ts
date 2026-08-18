import { describe, expect, it } from "vitest";
import { buildDistribution, type DistributionItem } from "./distribution";

const items: DistributionItem[] = Array.from({ length: 7 }, (_, index) => ({
  id: `m${index}`,
  label: `m${index}`,
  totalTokens: 70 - index * 10,
  estimatedCost: index === 6 ? null : 7 - index,
  estimatedCostStatus: index === 6 ? "unknown" : "complete",
}));

describe("distribution ranking", () => {
  it("uses Top 5 + Other and excludes unknown costs from cost denominator", () => {
    const tokens = buildDistribution(items, "tokens");
    expect(tokens.segments).toHaveLength(6);
    expect(tokens.segments.at(-1)?.label).toBe("其他");
    const cost = buildDistribution(items, "cost");
    expect(cost.unknown.map((item) => item.id)).toEqual(["m6"]);
    expect(cost.total).toBe(27);
  });
});
