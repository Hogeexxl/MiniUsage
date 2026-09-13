import { describe, expect, it } from "vitest";

import { formatCompact, formatCost, formatCostPerMillionTokens, formatInteger, formatLastSyncTime, formatRatio } from "./format";

describe("dashboard formatters", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1K"],
    [1_500, "1.5K"],
    [1_000_000, "1M"],
    [1_250_000_000, "1.3B"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatCompact(value)).toBe(expected);
  });

  it("keeps complete integers in title and accessible name", () => {
    expect(formatInteger(12_345)).toEqual({ text: "12.3K", title: "12345", accessibleName: "12345" });
  });

  it("does not turn null into zero", () => {
    expect(formatInteger(null).text).toBe("—");
    expect(formatRatio(null).text).toBe("—");
    expect(formatCost(null).text).toBe("—");
  });

  it("formats ratios and costs without changing input values", () => {
    const ratio = 0.125;
    const cost = 1.2;
    expect(formatRatio(ratio).text).toBe("12.5%");
    expect(formatCost(cost).text).toBe("$1.20");
    expect(ratio).toBe(0.125);
    expect(cost).toBe(1.2);
  });

  it("formats complete-session cost per MToken with quantity-based precision", () => {
    expect(formatCostPerMillionTokens(23.4567).text).toBe("$23.46 / MToken");
    expect(formatCostPerMillionTokens(6.2354).text).toBe("$6.235 / MToken");
    expect(formatCostPerMillionTokens(0.3474).text).toBe("$0.347 / MToken");
    expect(formatCostPerMillionTokens(null).text).toBe("— / MToken");
  });

  it("formats a completed sync timestamp as HH:mm:ss", () => {
    const value = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(formatLastSyncTime(value)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatLastSyncTime(null)).toBe("—");
  });
});
