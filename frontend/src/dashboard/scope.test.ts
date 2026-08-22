import { describe, expect, it } from "vitest";
import { DASHBOARD_SCOPE_POLICIES, resolveDashboardScope } from "./scope";

const filters = {
  models: ["b", "a", "a"],
  projects: [{ kind: "project" as const, project_path: "/repo" }],
};

describe("Dashboard scope policy", () => {
  it("keeps Dashboard scope for KPI/distributions/sessions and fixes Skills to rolling 7d", () => {
    for (const key of ["kpi", "modelDistribution", "projectDistribution", "sessions"] as const) {
      expect(resolveDashboardScope(DASHBOARD_SCOPE_POLICIES[key], { key: "30d" }, filters)).toEqual({
        range: { key: "30d" },
        filters: { models: ["a", "b"], projects: [{ kind: "project", project_path: "/repo" }] },
      });
    }
    expect(resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.skillsUsage, { key: "year" }, filters).range).toEqual({ key: "7d" });
  });

  it("T-022-A4 keeps a complete custom range in Dashboard scope while Skills stays fixed", () => {
    const custom = { key: "custom" as const, from: "2026-08-01", to: "2026-08-03" };
    expect(resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.sessions, custom, filters)).toEqual({
      range: custom,
      filters: { models: ["a", "b"], projects: [{ kind: "project", project_path: "/repo" }] },
    });
    expect(resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.skillsUsage, custom, filters).range).toEqual({ key: "7d" });
  });
});
