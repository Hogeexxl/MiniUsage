from pathlib import Path

# Scanner fixtures should track the schema introduced by this repair.
p = Path('src/scanner/mod.rs')
s = p.read_text(encoding='utf-8')
old = '        assert_eq!(user_version, 7);'
if s.count(old) != 2:
    raise SystemExit(f'expected two scanner schema assertions, found {s.count(old)}')
s = s.replace(old, '        assert_eq!(user_version, 8);')
p.write_text(s, encoding='utf-8')

# Storage opener expectations are intentionally about the latest supported schema.
p = Path('src/storage/mod.rs')
s = p.read_text(encoding='utf-8')
replacements = {
    'assert_eq!(ledger.schema_version().unwrap(), 7);': 'assert_eq!(ledger.schema_version().unwrap(), 8);',
    'assert_eq!(second.schema_version().unwrap(), 7);': 'assert_eq!(second.schema_version().unwrap(), 8);',
    'assert_eq!(error.schema_versions(), Some((99, 7)));': 'assert_eq!(error.schema_versions(), Some((99, 8)));',
}
for old, new in replacements.items():
    if old not in s:
        raise SystemExit(f'storage expectation missing: {old}')
    s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Migration tests that call the full migration runner now terminate at v8.
p = Path('src/storage/migrations.rs')
s = p.read_text(encoding='utf-8')
exact = {
    'fn v1_upgrade_preserves_metadata_and_installs_v7_usage_schema()': 'fn v1_upgrade_preserves_metadata_and_installs_v8_resilience_schema()',
    'fn t_dc_026_fresh_schema_is_v7_and_has_only_canonical_columns()': 'fn t_dc_026_fresh_schema_is_v8_and_has_only_canonical_columns()',
    'fn t_mu03_s01_v7_migration_fresh_upgrade_idempotence_and_rollback()': 'fn t_mu03_s01_v7_features_survive_v8_upgrade_idempotence_and_rollback()',
    'assert_eq!(migrate(&mut connection, 1).unwrap(), 7);': 'assert_eq!(migrate(&mut connection, 1).unwrap(), 8);',
    'assert_eq!(migrate(&mut connection, 3).unwrap(), 7);': 'assert_eq!(migrate(&mut connection, 3).unwrap(), 8);',
    'assert_eq!(migrate(&mut connection, 2).unwrap(), 7);': 'assert_eq!(migrate(&mut connection, 2).unwrap(), 8);',
    'assert_eq!(migrate(&mut fresh, 0).unwrap(), 7);': 'assert_eq!(migrate(&mut fresh, 0).unwrap(), 8);',
    'assert_eq!(ledger.schema_version().unwrap(), 7);': 'assert_eq!(ledger.schema_version().unwrap(), 8);',
    'assert_eq!(migrate(&mut connection, 7).unwrap(), 7);': 'assert_eq!(migrate(&mut connection, 7).unwrap(), 8);',
}
for old, new in exact.items():
    if old not in s:
        # Some migrate patterns legitimately occur more than once and are handled below.
        if old.startswith('assert_eq!(migrate(&mut connection, 2)') or old.startswith('assert_eq!(migrate(&mut connection, 3)'):
            continue
        raise SystemExit(f'migration expectation missing: {old}')
    s = s.replace(old, new)

# Remaining terminal PRAGMA/user_version expectations in this test module are
# schema assertions, not payload values. Limit replacements to the exact common shapes.
s = s.replace('        assert_eq!(version, 7);', '        assert_eq!(version, 8);')
s = s.replace('            7\n        );', '            8\n        );')

# Add explicit v8 smoke assertions to the fresh-schema contract once.
anchor = '''        assert_eq!(parent_provenance, "session_meta_parent");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_master
                     WHERE type='index' AND name='rollout_metadata_facts_thread_idx'",
'''
insert = '''        assert_eq!(parent_provenance, "session_meta_parent");
        connection
            .execute(
                "UPDATE rollout_metadata_facts
                 SET continuation_state='replayed_ancestor', ownership_confidence='confirmed'
                 WHERE source_file_id=1",
                [],
            )
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT continuation_state FROM rollout_metadata_facts WHERE source_file_id=1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "replayed_ancestor"
        );
        assert!(
            connection
                .execute(
                    "UPDATE rollout_metadata_facts SET ownership_confidence='unresolved'
                     WHERE source_file_id=1",
                    [],
                )
                .is_err()
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_master
                     WHERE type='table' AND name='usage_session_quarantine'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_master
                     WHERE type='index' AND name='rollout_metadata_facts_thread_idx'",
'''
if anchor not in s:
    raise SystemExit('fresh schema v8 assertion anchor missing')
s = s.replace(anchor, insert, 1)
p.write_text(s, encoding='utf-8')
