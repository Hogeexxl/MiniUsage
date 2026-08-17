from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Keep the pre-existing cost-cell contract: only a known partial subtotal is
# highlighted. Session health is a separate row-level concern; an unknown cost
# stays as an em dash without the partial-cost class.
replace_once(
    "frontend/src/dashboard/session/SessionTableRow.tsx",
    '''  const costClassName = item.data_status === "incomplete"\n    ? "session-cost-cell is-partial"\n    : "session-cost-cell";''',
    '''  const costClassName = inclusive?.estimated_cost_status === "partial"\n    ? "session-cost-cell is-partial"\n    : "session-cost-cell";''',
    "session cost class",
)

# Update the canonical frontend fixtures to the new API contract. These are
# contract updates, not relaxed assertions: production DTO fields remain
# required and tests now provide them explicitly.
replace_once(
    "frontend/src/dashboard/MetricGrid.test.tsx",
    '''  estimated_cost_status: "unknown" as const,\n  session_count: 0,\n};''',
    '''  estimated_cost_status: "unknown" as const,\n  session_count: 0,\n  session_health: {\n    total_sessions: 0,\n    complete_sessions: 0,\n    incomplete_sessions: 0,\n    error_sessions: 0,\n  },\n};''',
    "metric grid health fixture",
)

replace_once(
    "frontend/src/dashboard/DashboardPage.test.tsx",
    '''    estimated_cost_status: "unknown" as const,\n    session_count: 1,\n  },''',
    '''    estimated_cost_status: "unknown" as const,\n    session_count: 1,\n    session_health: {\n      total_sessions: 1,\n      complete_sessions: 1,\n      incomplete_sessions: 0,\n      error_sessions: 0,\n    },\n  },''',
    "dashboard health fixture",
)

replace_once(
    "frontend/src/dashboard/session/SessionTableRow.test.tsx",
    '''  subagent_usage: { ...usage, estimated_cost: null, estimated_cost_status: "unknown" },\n};''',
    '''  subagent_usage: { ...usage, estimated_cost: null, estimated_cost_status: "unknown" },\n  data_status: "complete",\n  error_code: null,\n};''',
    "session row health fixture",
)

print("frontend health contract fixes applied")
