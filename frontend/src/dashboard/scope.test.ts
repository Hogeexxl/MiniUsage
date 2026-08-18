import { describe, expect, it } from "vitest";
import { DASHBOARD_SCOPE_POLICIES, resolveDashboardScope } from "./scope";

const filters = {
  models: ["b", "a", "a"],
  projects: [{ kind: "project" as const, project_path: "/repo" }],
};

describe("Dashboard scope policy", () => {
  it("keeps Dashboard scope for KPI/distributions/sessions and fixes Skills to rolling 7d", () => {
    for (const key of ["kpi", "modelDistribution", "projectDistribution", "sessions"] as const) {
      expect(resolveDashboardScope(DASHBOARD_SCOPE_POLICIES[key], "30d", filters)).toEqual({
        range: "30d",
        filters: { models: ["a", "b"], projects: [{ kind: "project", project_path: "/repo" }] },
      });
    }
    expect(resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.skillsUsage, "year", filters).range).toBe("7d");
  });
});
