from pathlib import Path

p = Path('src/api/query.rs')
s = p.read_text(encoding='utf-8')

health = '''                    health: crate::usage::aggregate::SessionHealthSummary {
                        total_sessions: 0,
                        complete_sessions: 0,
                        incomplete_sessions: 0,
                        error_sessions: 0,
                    },
'''
needle = '''                    session_count: 0,
                },'''
if s.count(needle) != 1:
    raise SystemExit(f'expected one canonical zero summary fixture, found {s.count(needle)}')
s = s.replace(needle, '                    session_count: 0,\n' + health + '                },', 1)
overflow = '''                    value: UsageSummary {
                        totals: totals(Some(3), 1, 0),
                        session_count: 0,
                    },'''
overflow_new = '''                    value: UsageSummary {
                        totals: totals(Some(3), 1, 0),
                        session_count: 0,
                        health: crate::usage::aggregate::SessionHealthSummary {
                            total_sessions: 0,
                            complete_sessions: 0,
                            incomplete_sessions: 0,
                            error_sessions: 0,
                        },
                    },'''
if overflow not in s:
    raise SystemExit('overflow summary fixture not found')
s = s.replace(overflow, overflow_new, 1)
old = '''                    last_activity_at_ms: 20,
                    models_used: vec!["unknown".into(), "gpt-5".into()],
                }],
                sort_index: vec![SessionSortIndexItem {
                    root_session_id: "root-a".into(),
                    last_activity_at_ms: 20,
                    project_sort_key: None,
                    model_sort_key: Some("unknown".into()),
                    total_tokens: 12,
                    combined_total_tokens: 12,
                    cache_hit_rate: Some(0.4),
                }],'''
new = '''                    last_activity_at_ms: 20,
                    models_used: vec!["unknown".into(), "gpt-5".into()],
                    data_status: SessionDataStatus::Incomplete,
                    error_code: None,
                }],
                sort_index: vec![SessionSortIndexItem {
                    root_session_id: "root-a".into(),
                    last_activity_at_ms: 20,
                    project_sort_key: None,
                    model_sort_key: Some("unknown".into()),
                    total_tokens: Some(12),
                    combined_total_tokens: Some(12),
                    cache_hit_rate: Some(0.4),
                    data_status: SessionDataStatus::Incomplete,
                    error_code: None,
                }],'''
if old not in s:
    raise SystemExit('session snapshot fixture shape not found')
s = s.replace(old, new, 1)
for field in ['inclusive_usage', 'self_usage', 'subagent_usage']:
    s = s.replace(f'response.items[0].{field}.', f'response.items[0].{field}.as_ref().unwrap().')
p.write_text(s, encoding='utf-8')

# Aggregate unit fixtures predate schema v8. Add the read-only quarantine
# projection table to every fixture that creates usage_events. IF NOT EXISTS
# keeps the main fixture compatible with the table already injected by the
# production-health patch.
p = Path('src/usage/aggregate.rs')
s = p.read_text(encoding='utf-8')
head, marker, tests = s.partition('#[cfg(test)]')
if not marker:
    raise SystemExit('aggregate test module marker missing')
health_table = '''CREATE TABLE IF NOT EXISTS usage_session_quarantine (
                    ledger_epoch INTEGER NOT NULL, root_session_id TEXT NOT NULL,
                    primary_error_code TEXT NOT NULL, last_activity_at_ms INTEGER NOT NULL,
                    first_seen_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
                 );
                 '''
tests = tests.replace('CREATE TABLE usage_session_quarantine (', 'CREATE TABLE IF NOT EXISTS usage_session_quarantine (')
count = tests.count('CREATE TABLE usage_events (')
if count == 0:
    raise SystemExit('aggregate usage_events fixtures missing')
tests = tests.replace('CREATE TABLE usage_events (', health_table + 'CREATE TABLE usage_events (')
# The health query no longer needs a mutable parameter index when there are no
# later optional bind groups.
tests = tests
s = head + marker + tests
# Production helper warning cleanup.
s = s.replace('        let mut next = 4_usize;\n', '        let next = 4_usize;\n', 1)
p.write_text(s, encoding='utf-8')
