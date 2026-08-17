from pathlib import Path

# Fix state_index tests after moving path identity to platform::paths.
p = Path('src/codex/state_index.rs')
s = p.read_text(encoding='utf-8')
s = s.replace('    path::{Path, PathBuf},\n', '    path::Path,\n', 1)
s = s.replace('    use std::{\n        fs,\n', '    use std::{\n        fs,\n        path::PathBuf,\n', 1)
old = '''        let expected_rollout_path = normalize_absolute_path(&rollout_path).unwrap();
        let expected_cwd_path = normalize_absolute_path(&fixture_path("work/project")).unwrap();'''
new = '''        let expected_rollout_path = paths::normalize_source_path(Path::new(&rollout_path))
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let expected_cwd_path = paths::normalize_source_path(Path::new(&fixture_path("work/project")))
            .unwrap()
            .to_string_lossy()
            .into_owned();'''
if old not in s:
    raise SystemExit('state_index expected path test shape not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')

# Turn the historical EOF-in-replay failure case into the regression for the
# new durable continuation, then add a non-zero incremental recovery test.
p = Path('src/codex/rollout.rs')
s = p.read_text(encoding='utf-8')
start = s.index('    #[test]\n    fn unresolved_live_boundary_keeps_replayed_range_and_unresolved_confidence()')
end = s.index('    #[test]\n    fn normal_nonzero_owning_live_resume_restores_model_ordering_seam()', start)
replacement = r'''    #[test]
    fn eof_in_replayed_ancestor_is_stable_resumable_continuation() {
        let parent = uuid7(1_000, 1);
        let child = uuid7(2_000, 2);
        let parent_turn = uuid7(1_500, 3);
        let records = vec![
            format!(r#"{{"type":"session_meta","payload":{{"id":"{child}"}}}}"#),
            format!(r#"{{"type":"session_meta","payload":{{"id":"{parent}"}}}}"#),
            format!(
                r#"{{"type":"turn_context","payload":{{"turn_id":"{parent_turn}","model":"parent-model"}}}}"#
            ),
            r#"{"type":"turn_context","payload":{"model":"missing-turn-id"}}"#.to_owned(),
            r#"{"type":"event_msg","payload":{"type":"token_count"}}"#.to_owned(),
        ];
        let result = RolloutMetadataParser::parse_chunk(
            context(0, &child, ResumeState::AwaitOwningMeta, None),
            lines(&records, 0),
        );
        assert!(!result.needs_rebuild);
        assert_eq!(
            result.final_continuation,
            FinalContinuation::ReplayedAncestor {
                owning_thread_id: child.clone(),
            }
        );
        assert_eq!(
            result.records.iter().map(|record| record.ownership).collect::<Vec<_>>(),
            vec![
                RecordOwnership::Owning,
                RecordOwnership::ReplayedAncestor,
                RecordOwnership::ReplayedAncestor,
                RecordOwnership::ReplayedAncestor,
                RecordOwnership::ReplayedAncestor,
            ]
        );
        assert_eq!(result.ownership_ranges.len(), 2);
        let fact = result.fact.unwrap();
        assert_eq!(fact.ownership_boundary.confidence, OwnershipConfidence::Confirmed);
        assert_eq!(fact.latest_context_model, None);
        let safe = fact
            .to_safe_fact(
                1,
                METADATA_PARSER_VERSION,
                result.last_processed_offset,
                10,
                &result.final_continuation,
            )
            .unwrap();
        assert_eq!(safe.continuation_state, crate::domain::ContinuationState::ReplayedAncestor);
        assert_eq!(safe.ownership_confidence, crate::domain::OwnershipConfidence::Confirmed);
    }

    #[test]
    fn nonzero_replayed_ancestor_resume_stays_replay_until_owning_boundary() {
        let child = uuid7(2_000, 2);
        let parent_turn = uuid7(1_500, 3);
        let child_turn = uuid7(2_100, 4);
        let mut existing = RolloutThreadFact::empty(7, child.clone());
        existing.ownership_boundary.replay_start_offset = Some(20);
        let replay_records = vec![
            format!(r#"{{"type":"turn_context","payload":{{"turn_id":"{parent_turn}","model":"parent"}}}}"#),
            r#"{"type":"event_msg","payload":{"type":"token_count"}}"#.to_owned(),
        ];
        let replay = RolloutMetadataParser::parse_chunk(
            context(
                100,
                &child,
                ResumeState::ReplayedAncestor { owning_thread_id: child.clone() },
                Some(existing),
            ),
            lines(&replay_records, 100),
        );
        assert!(!replay.needs_rebuild);
        assert_eq!(
            replay.final_continuation,
            FinalContinuation::ReplayedAncestor { owning_thread_id: child.clone() }
        );
        assert!(replay.records.iter().all(|record| record.ownership == RecordOwnership::ReplayedAncestor));
        let resume_offset = replay.last_processed_offset;
        let owning_record = format!(
            r#"{{"type":"turn_context","payload":{{"turn_id":"{child_turn}","model":"child"}}}}"#
        );
        let owning = RolloutMetadataParser::parse_chunk(
            context(
                resume_offset,
                &child,
                ResumeState::ReplayedAncestor { owning_thread_id: child.clone() },
                replay.fact,
            ),
            lines(&[owning_record], resume_offset),
        );
        assert!(!owning.needs_rebuild);
        assert_eq!(owning.final_continuation, FinalContinuation::OwningLive { owning_thread_id: child });
        assert_eq!(owning.records[0].ownership, RecordOwnership::Owning);
    }

'''
s = s[:start] + replacement + s[end:]
p.write_text(s, encoding='utf-8')
