from pathlib import Path

p = Path('src/usage/aggregate.rs')
s = p.read_text(encoding='utf-8')
s = s.replace('        let session_count = self\n', '        let session_count: i64 = self\n', 1)
old = '''            let models_used = self.models_for_root(epoch, range, &root_session_id)?;
            output.push(SessionUsageRow {'''
new = '''            let models_used = self.models_for_root(epoch, range, &root_session_id)?;
            let data_status = status_for_totals(&inclusive_usage);
            output.push(SessionUsageRow {'''
if old not in s:
    raise SystemExit('legacy sessions row anchor missing')
s = s.replace(old, new, 1)
old = '''                last_activity_at_ms,
                models_used,
            });'''
new = '''                last_activity_at_ms,
                models_used,
                data_status,
                error_code: None,
            });'''
if old not in s:
    raise SystemExit('legacy sessions row fields missing')
s = s.replace(old, new, 1)
old = '''        let models_used = self.models_for_root(epoch, range, root)?;
        Ok(SessionUsageRow {'''
new = '''        let models_used = self.models_for_root(epoch, range, root)?;
        let data_status = status_for_totals(&inclusive_usage);
        Ok(SessionUsageRow {'''
if old not in s:
    raise SystemExit('session_row status anchor missing')
s = s.replace(old, new, 1)
s = s.replace('            data_status: status_for_totals(&inclusive_usage),\n', '            data_status,\n', 1)
# Only the quarantine helper has no later bind groups after project paths.
old = '''        let mut next = 4_usize;
        let mut projects = Vec::new();'''
new = '''        let next = 4_usize;
        let mut projects = Vec::new();'''
if old not in s:
    raise SystemExit('quarantine next binding shape missing')
s = s.replace(old, new, 1)
old = '''            values.extend(filter.project_paths.iter().cloned().map(Value::Text));
            next += filter.project_paths.len();
        }
        if filter.include_projectless {'''
new = '''            values.extend(filter.project_paths.iter().cloned().map(Value::Text));
        }
        if filter.include_projectless {'''
if old not in s:
    raise SystemExit('quarantine project bind increment shape missing')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
