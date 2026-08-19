import { describe, expect, it } from "vitest";
import { buildDistribution, type DistributionItem } from "./distribution";

const items: DistributionItem[] = Array.from({ length: 7 }, (_, index) => ({
  id: `m${index}`,
  label: `m${index}`,
  totalTokens: 70 - index * 10,
  estimatedCost: index === 6 ? null : 7 - index,
  estimatedCostStatus: index === 6 ? "unknown" : index === 5 ? "partial" : "complete",
}));

describe("distribution ranking", () => {
  it("uses Top 5 + Other for tokens", () => {
    const tokens = buildDistribution(items, "tokens");
    expect(tokens.segments).toHaveLength(6);
    expect(tokens.segments.at(-1)?.label).toBe("其他");
    expect(tokens.total).toBe(items.reduce((sum, item) => sum + item.totalTokens, 0));
  });

  it("excludes unknown cost while keeping known partial cost in the denominator", () => {
    const cost = buildDistribution(items, "cost");
    expect(cost.unknown.map((item) => item.id)).toEqual(["m6"]);
    expect(cost.total).toBe(27);
    expect(cost.segments.some((segment) => segment.id === "m5")).toBe(true);
  });
});
