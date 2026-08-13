import { describe, expect, it } from "vitest";

import {
  formatModelWithReasoningEffort,
  formatSessionModel,
  formatSessionProject,
  formatSessionTime,
  formatSessionTitle,
  formatSessionTokenInteger,
} from "./sessionFormat";

describe("Session presentation contract", () => {
  it("keeps title/project/model fallbacks and exposes the full model list", () => {
    expect(formatSessionTitle("  ")).toBe("未命名 Session");
    expect(formatSessionProject(null)).toBe("未识别项目");
    expect(formatSessionModel([])).toMatchObject({ text: "unknown", accessibleName: "unknown" });
    expect(formatSessionModel(["gpt-5", "o4-mini"])).toMatchObject({ text: "gpt-5 +1", title: "gpt-5, o4-mini" });
  });

  it("formats same-day, same-year, and cross-year timestamps in the API timezone", () => {
    const now = Date.UTC(2026, 7, 10, 8, 9, 10);
    expect(formatSessionTime(Date.UTC(2026, 7, 10, 7, 8, 0), "Asia/Shanghai", now).text).toBe("15:08");
    expect(formatSessionTime(Date.UTC(2026, 6, 1, 7, 8, 0), "Asia/Shanghai", now).text).toBe("07-01 15:08");
    expect(formatSessionTime(Date.UTC(2025, 11, 1, 7, 8, 0), "Asia/Shanghai", now).text).toBe("2025-12-01 15:08");
    expect(() => formatSessionTime(now, "Not/A-Timezone", now)).toThrow(RangeError);
  });

  it("uses a complete locale-aware integer formatter for Session tokens", () => {
    expect(formatSessionTokenInteger(1_801)).toMatchObject({ text: "1,801", title: "1801", accessibleName: "1801" });
    expect(formatSessionTokenInteger(1_000_000_000).text).toBe("1,000,000,000");
  });

  it("formats exact reasoning effort labels without allowlists or defaults", () => {
    expect(formatModelWithReasoningEffort("gpt-5.6-sol", "high", false)).toBe("gpt-5.6-sol (high)");
    expect(formatModelWithReasoningEffort("gpt-5.6-sol", null, false)).toBe("gpt-5.6-sol (—)");
    expect(formatModelWithReasoningEffort("gpt-5.6-sol", null, true)).toBe("gpt-5.6-sol (mixed)");
    expect(formatModelWithReasoningEffort("model-x", "custom", false)).toBe("model-x (custom)");
  });
});
