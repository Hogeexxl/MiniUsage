from pathlib import Path
import re

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
text = text.replace(
    'use rusqlite::{TransactionBehavior, params, params_from_iter, types::Value};',
    'use rusqlite::{TransactionBehavior, params_from_iter, types::Value};',
)
commit_marker = '''    transaction.commit().map_err(StorageError::sqlite)?;\n    Ok(AnalyticsSnapshot { data_revision, active_epoch, value })'''
commit_fixed = '''    drop(statement);\n    transaction.commit().map_err(StorageError::sqlite)?;\n    Ok(AnalyticsSnapshot { data_revision, active_epoch, value })'''
if commit_marker in text:
    text = text.replace(commit_marker, commit_fixed, 2)
path.write_text(text, encoding="utf-8")

# The 7d/30d protocol intentionally replaces calendar week/month. Align the
# deterministic UTC matrix with rolling whole-local-day boundaries.
range_path = root / "src/range.rs"
range_value = range_path.read_text(encoding="utf-8")
range_value = range_value.replace(
    '''            (\n                RangeKey::Week,\n                "2026-08-03T00:00:00Z",\n                "2026-08-10T00:00:00Z",\n            ),\n            (\n                RangeKey::Month,\n                "2026-08-01T00:00:00Z",\n                "2026-09-01T00:00:00Z",\n            ),''',
    '''            (\n                RangeKey::Week,\n                "2026-08-02T00:00:00Z",\n                "2026-08-09T00:00:00Z",\n            ),\n            (\n                RangeKey::Month,\n                "2026-07-10T00:00:00Z",\n                "2026-08-09T00:00:00Z",\n            ),''',
)
range_path.write_text(range_value, encoding="utf-8")

# Schema v9 and usage parser v8 are deliberate compatibility-version bumps.
# Update only assertions that ask the migrator/current runtime for the latest
# schema/parser; historical fixture versions remain untouched.
migrations_path = root / "src/storage/migrations.rs"
migrations = migrations_path.read_text(encoding="utf-8")
migrations = re.sub(
    r'assert_eq!\(migrate\(&mut connection, ([^)]+)\)\.unwrap\(\), 8\);',
    r'assert_eq!(migrate(&mut connection, \1).unwrap(), 9);',
    migrations,
)
migrations = migrations.replace("assert_eq!(version, 8);", "assert_eq!(version, 9);")
migrations = re.sub(
    r'(query_row\("PRAGMA user_version"[\s\S]{0,180}?\.unwrap\(\),\n\s*)8(\n\s*\);)',
    r'\g<1>9\2',
    migrations,
)
migrations_path.write_text(migrations, encoding="utf-8")

storage_mod_path = root / "src/storage/mod.rs"
storage_mod = storage_mod_path.read_text(encoding="utf-8")
storage_mod = storage_mod.replace("assert_eq!(ledger.schema_version().unwrap(), 8);", "assert_eq!(ledger.schema_version().unwrap(), 9);")
storage_mod = storage_mod.replace("Some((99, 8))", "Some((99, 9))")
storage_mod_path.write_text(storage_mod, encoding="utf-8")

scanner_path = root / "src/scanner/mod.rs"
scanner_value = scanner_path.read_text(encoding="utf-8")
scanner_value = scanner_value.replace("assert_eq!(user_version, 8);", "assert_eq!(user_version, 9);")
scanner_path.write_text(scanner_value, encoding="utf-8")

normalized_path = root / "src/usage/normalized.rs"
normalized = normalized_path.read_text(encoding="utf-8")
normalized = normalized.replace("assert_eq!(USAGE_PARSER_VERSION, 7);", "assert_eq!(USAGE_PARSER_VERSION, 8);")
normalized_path.write_text(normalized, encoding="utf-8")

processor_path = root / "src/usage/processor.rs"
processor = processor_path.read_text(encoding="utf-8")
processor = processor.replace("assert_eq!(crate::usage::USAGE_PARSER_VERSION, 7);", "assert_eq!(crate::usage::USAGE_PARSER_VERSION, 8);")
processor = processor.replace("assert_eq!(USAGE_PARSER_VERSION, 7);", "assert_eq!(USAGE_PARSER_VERSION, 8);")
processor_path.write_text(processor, encoding="utf-8")

# The existing UsageLedger unit helper constructs the complete pipeline DTO.
ledger_test = root / "src/usage/ledger.rs"
ledger_value = ledger_test.read_text(encoding="utf-8")
ledger_anchor = '''            occurrences: vec![super::super::processor::Occurrence {\n                source_file_id: 1,\n                file_generation: 1,\n                source_start_offset: 0,\n                source_end_offset: 1,\n                event_id,\n            }],\n            closed_turns: Vec::new(),\n'''
ledger_replacement = '''            occurrences: vec![super::super::processor::Occurrence {\n                source_file_id: 1,\n                file_generation: 1,\n                source_start_offset: 0,\n                source_end_offset: 1,\n                event_id,\n            }],\n            skill_events: Vec::new(),\n            closed_turns: Vec::new(),\n'''
if ledger_anchor in ledger_value and "skill_events: Vec::new()" not in ledger_value:
    ledger_value = ledger_value.replace(ledger_anchor, ledger_replacement, 1)
ledger_test.write_text(ledger_value, encoding="utf-8")

# Existing frontend tests inject complete MiniUsageClient fixtures.
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
