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

# Scope bind-index cleanup strictly to the newly inserted quarantine helper.
start = s.index('    fn quarantined_roots(')
end = s.index('    fn aggregate_for_root', start)
helper = s[start:end]
anchor = '''        if !filter.models.is_empty() {
            return Ok(Vec::new());
        }
'''
insert = '''        if !filter.models.is_empty() {
            return Ok(Vec::new());
        }
        let quarantine_count: i64 = self
            .connection
            .query_row(
                "SELECT COUNT(*) FROM usage_session_quarantine WHERE ledger_epoch=?1",
                [epoch],
                |row| row.get(0),
            )
            .map_err(map_sql_error)?;
        if quarantine_count == 0 {
            return Ok(Vec::new());
        }
'''
if anchor not in helper:
    raise SystemExit('quarantine short-circuit anchor missing')
helper = helper.replace(anchor, insert, 1)
old = '        let mut next = 4_usize;\n'
if old not in helper:
    raise SystemExit('quarantine next binding missing')
helper = helper.replace(old, '        let next = 4_usize;\n', 1)
old = '''            values.extend(filter.project_paths.iter().cloned().map(Value::Text));
            next += filter.project_paths.len();
        }
        if filter.include_projectless {'''
new = '''            values.extend(filter.project_paths.iter().cloned().map(Value::Text));
        }
        if filter.include_projectless {'''
if old not in helper:
    raise SystemExit('quarantine project bind increment missing')
helper = helper.replace(old, new, 1)
s = s[:start] + helper + s[end:]
p.write_text(s, encoding='utf-8')
