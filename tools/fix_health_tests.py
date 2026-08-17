from pathlib import Path

p = Path('src/api/query.rs')
s = p.read_text(encoding='utf-8')

# Two summary fixtures in the DTO mapping test need explicit health state.
needle = '''                    session_count: 0,
                },'''
replacement = '''                    session_count: 0,
                    health: crate::usage::aggregate::SessionHealthSummary {
                        total_sessions: 0,
                        complete_sessions: 0,
                        incomplete_sessions: 0,
                        error_sessions: 0,
                    },
                },'''
count = s.count(needle)
if count < 2:
    raise SystemExit(f'expected at least two summary fixtures, found {count}')
s = s.replace(needle, replacement, 2)

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
