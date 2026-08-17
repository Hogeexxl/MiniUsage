from pathlib import Path

p = Path('frontend/src/data/miniUsageClient.test.ts')
s = p.read_text(encoding='utf-8')
old = '''    const sortIndex = {
      root_session_id: "root-1",
      last_activity_at_ms: 1_700_000_000_000,
      project_sort_key: "/work/MiniUsage",
      model_sort_key: "gpt-5",
      total_tokens: 30,
      combined_total_tokens: 30,
      cache_hit_rate: 0.4,
    };
    const partialSessionUsage ='''
new = '''    const sortIndex = {
      root_session_id: "root-1",
      last_activity_at_ms: 1_700_000_000_000,
      project_sort_key: "/work/MiniUsage",
      model_sort_key: "gpt-5",
      total_tokens: 30,
      combined_total_tokens: 30,
      cache_hit_rate: 0.4,
      data_status: "incomplete",
      error_code: null,
    };
    const partialSessionUsage ='''
if s.count(old) != 1:
    raise SystemExit(f'partial-cost sort fixture: expected 1 match, got {s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('frontend pre-fix applied')
