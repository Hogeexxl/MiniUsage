from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = Path(__file__).with_name("v013-implement.py")
text = path.read_text(encoding="utf-8")
old = 'replace_once("src/codex/mod.rs", "mod global_state;\\nmod metadata;", "mod global_state;\\nmod metadata;\\nmod skill_usage;")'
new = 'replace_once("src/codex/mod.rs", "pub mod global_state;\\npub mod metadata;", "pub mod global_state;\\npub mod metadata;\\nmod skill_usage;")'
if old in text:
    text = text.replace(old, new, 1)
needle = '''pipeline = pipeline.replace("""        result,\n        last,""", """        result,\n        skill_events,\n        last,""")\n'''
addition = '''pipeline = pipeline.replace("""        result,\n        last,""", """        result,\n        skill_events,\n        last,""")\npipeline = pipeline.replace("""        },\n        last,""", """        },\n        skill_events,\n        last,""")\n'''
if needle in text and addition not in text:
    text = text.replace(needle, addition, 1)
# The generated model/project aggregate statements borrow their transaction;
# explicitly drop them before committing the read transaction.
text = text.replace(
    'use rusqlite::{TransactionBehavior, params, params_from_iter, types::Value};',
    'use rusqlite::{TransactionBehavior, params_from_iter, types::Value};',
)
commit_marker = '''    transaction.commit().map_err(StorageError::sqlite)?;\n    Ok(AnalyticsSnapshot { data_revision, active_epoch, value })'''
commit_fixed = '''    drop(statement);\n    transaction.commit().map_err(StorageError::sqlite)?;\n    Ok(AnalyticsSnapshot { data_revision, active_epoch, value })'''
if commit_marker in text:
    text = text.replace(commit_marker, commit_fixed, 2)
path.write_text(text, encoding="utf-8")

# Existing DashboardPage tests inject a complete MiniUsageClient. Extend that
# test fixture with v0.1.3 analytics methods instead of weakening production
# client types.
dashboard_test = root / "frontend/src/dashboard/DashboardPage.test.tsx"
dashboard = dashboard_test.read_text(encoding="utf-8")
anchor = '''    summary: vi.fn(async (range) => (range === "today" ? summary("today") : summary("yesterday"))),\n'''
fixture = '''    summary: vi.fn(async (range) => (range === "today" ? summary("today") : summary("yesterday"))),\n    modelDistribution: vi.fn(async (range) => ({\n      range: { key: range, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },\n      data_revision: 1,\n      items: [],\n    })),\n    projectDistribution: vi.fn(async (range) => ({\n      range: { key: range, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },\n      data_revision: 1,\n      items: [],\n    })),\n    skillsUsage: vi.fn(async () => ({\n      range: { key: "7d" as const, start_ms: 1, end_ms: 8, timezone: "Asia/Shanghai" },\n      data_revision: 1,\n      data_status: "ready" as const,\n      days: Array.from({ length: 7 }, (_, index) => ({\n        date: `2026-08-${String(index + 1).padStart(2, "0")}`,\n        start_ms: index + 1,\n        end_ms: index + 2,\n        total: 0,\n        skills: [],\n      })),\n    })),\n'''
if anchor in dashboard and "modelDistribution: vi.fn" not in dashboard:
    dashboard = dashboard.replace(anchor, fixture, 1)
dashboard_test.write_text(dashboard, encoding="utf-8")

range_test = root / "frontend/src/dashboard/RangeSelector.test.tsx"
if range_test.exists():
    value = range_test.read_text(encoding="utf-8")
    value = value.replace("本月", "30天")
    range_test.write_text(value, encoding="utf-8")

# Controller/revision tests also construct the full client interface. Their
# analytics calls are irrelevant to those focused tests, so typed empty mocks
# satisfy the new interface without changing behavior.
for rel in [
    "frontend/src/dashboard/session/useSessionDetailController.test.tsx",
    "frontend/src/dashboard/session/useSessionTableController.test.tsx",
    "frontend/src/dashboard/useDashboardController.test.tsx",
    "frontend/src/data/revisionFeed.test.ts",
]:
    test_path = root / rel
    value = test_path.read_text(encoding="utf-8")
    if "modelDistribution: vi.fn()" in value:
        continue
    target = "    summary: vi.fn(),\n"
    if rel.endswith("useDashboardController.test.tsx"):
        target = "    summary: vi.fn(async (range) => summary(range)),\n"
    if target not in value:
        raise RuntimeError(f"{rel}: MiniUsageClient summary fixture anchor missing")
    replacement = target + "    modelDistribution: vi.fn(),\n    projectDistribution: vi.fn(),\n    skillsUsage: vi.fn(),\n"
    value = value.replace(target, replacement, 1)
    test_path.write_text(value, encoding="utf-8")
