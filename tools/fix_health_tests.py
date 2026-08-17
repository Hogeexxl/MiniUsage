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

# The zero summary fixture has the canonical closing indentation.
needle = '''                    session_count: 0,
                },'''
if s.count(needle) != 1:
    raise SystemExit(f'expected one canonical zero summary fixture, found {s.count(needle)}')
s = s.replace(needle, '                    session_count: 0,\n' + health + '                },', 1)

# The overflow fixture uses a compact totals() initializer and a different nesting depth.
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

# Healthy Session fixture now carries explicit health and optional sort values.
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

# Healthy/incomplete session DTOs still have usage values; unwrap in old assertions.
for field in ['inclusive_usage', 'self_usage', 'subagent_usage']:
    s = s.replace(f'response.items[0].{field}.', f'response.items[0].{field}.as_ref().unwrap().')

p.write_text(s, encoding='utf-8')
