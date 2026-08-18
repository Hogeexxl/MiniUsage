use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use mini_usage::{
    domain::{
        CheckpointProcessingStatus, ContinuationState, FactQualityStatus,
        MetadataCheckpointAdvance, MetadataCommitBatch, MetadataSourceCommit, MetadataThreadCommit,
        OwnershipConfidence, RolloutMetadataFact, ScanResult,
    },
    scanner::{CodexMetadata, ScanConfig, ScanCoordinator},
    storage::{Ledger, LedgerOptions},
};
use rusqlite::{Connection, params};
use serde_json::json;
use uuid::Uuid;

struct TempRoot(PathBuf);

impl TempRoot {
    fn new(label: &str) -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "miniusage-replayed-ancestor-{label}-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temporary test directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn fixture_path(root: &Path, name: &str) -> String {
    root.join(name).to_string_lossy().into_owned()
}

fn insert_source(db_path: &Path, source_path: &str) {
    Connection::open(db_path)
        .expect("open ledger query")
        .execute(
            "INSERT INTO source_files (
                source_file_id, thread_id, current_path, source_area,
                device_id, inode, file_generation, observed_size,
                observed_mtime_ns, file_status, last_seen_at_ms
             ) VALUES (1, NULL, ?1, 'sessions', 1, 2, 1, 10, 0, 'present', 10)",
            [source_path],
        )
        .expect("insert source fixture");
}

fn source_fact(continuation_state: ContinuationState) -> RolloutMetadataFact {
    RolloutMetadataFact {
        source_file_id: 1,
        file_generation: 1,
        metadata_parser_version: 1,
        resolved_through_offset: 10,
        owning_thread_id: "thread".to_owned(),
        continuation_state,
        cwd: None,
        cwd_provenance: None,
        cwd_record_offset: None,
        created_at_ms: None,
        latest_context_model: None,
        latest_context_at_ms: None,
        parent_thread_id_hint: None,
        parent_hint_provenance: None,
        parent_hint_record_offset: None,
        agent_role_hint: None,
        agent_role_provenance: None,
        agent_role_record_offset: None,
        agent_path: None,
        agent_path_provenance: None,
        agent_path_record_offset: None,
        replay_start_offset: Some(1),
        owning_records_start_offset: None,
        ownership_confidence: match continuation_state {
            ContinuationState::Unstable => OwnershipConfidence::Unresolved,
            ContinuationState::ReplayedAncestor | ContinuationState::OwningLive => {
                OwnershipConfidence::Confirmed
            }
        },
        fact_quality_status: FactQualityStatus::Complete,
        updated_at_ms: 10,
    }
}

fn source_commit(continuation_state: ContinuationState) -> MetadataSourceCommit {
    MetadataSourceCommit::new(
        1,
        1,
        None,
        "thread",
        source_fact(continuation_state),
        MetadataCheckpointAdvance {
            parser_version: 1,
            committed_offset: 10,
            guard_hash: Some(vec![1]),
            processing_status: CheckpointProcessingStatus::Ready,
            last_successful_scan_at_ms: Some(10),
            last_error_code: None,
        },
    )
    .expect("assemble metadata source commit")
}

#[test]
fn replayed_ancestor_nonzero_metadata_checkpoint_is_storage_legal() {
    let root = TempRoot::new("storage-positive");
    let home = root.path().join("codex");
    fs::create_dir_all(&home).unwrap();
    let db_path = root.path().join("mu.sqlite3");
    let ledger = Ledger::open(LedgerOptions::new(&db_path, &home)).expect("open ledger");
    insert_source(&db_path, &fixture_path(root.path(), "rollout.jsonl"));

    let group = MetadataThreadCommit::new(
        "thread",
        None,
        vec![source_commit(ContinuationState::ReplayedAncestor)],
    )
    .unwrap();
    ledger
        .commit_metadata(MetadataCommitBatch::new(vec![group]).unwrap())
        .expect("replayed ancestor must be persistable at a nonzero checkpoint");

    let connection = Connection::open(&db_path).unwrap();
    let row: (Option<String>, String, i64, String) = connection
        .query_row(
            "SELECT
                sf.thread_id,
                f.continuation_state,
                sc.committed_offset,
                sc.processing_status
             FROM source_files sf
             JOIN rollout_metadata_facts f USING (source_file_id)
             JOIN source_checkpoints sc USING (source_file_id)
             WHERE sf.source_file_id=1 AND sc.consumer_kind='metadata'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        row,
        (
            Some("thread".to_owned()),
            "replayed_ancestor".to_owned(),
            10,
            "ready".to_owned(),
        )
    );
}

#[test]
fn unstable_nonzero_metadata_checkpoint_stays_rejected() {
    let root = TempRoot::new("storage-negative");
    let home = root.path().join("codex");
    fs::create_dir_all(&home).unwrap();
    let db_path = root.path().join("mu.sqlite3");
    let ledger = Ledger::open(LedgerOptions::new(&db_path, &home)).expect("open ledger");
    insert_source(&db_path, &fixture_path(root.path(), "rollout.jsonl"));

    let group = MetadataThreadCommit::new(
        "thread",
        None,
        vec![source_commit(ContinuationState::Unstable)],
    )
    .unwrap();
    assert!(
        ledger
            .commit_metadata(MetadataCommitBatch::new(vec![group]).unwrap())
            .is_err()
    );

    let connection = Connection::open(&db_path).unwrap();
    let durable: (Option<String>, i64, i64) = connection
        .query_row(
            "SELECT
                thread_id,
                (SELECT count(*) FROM rollout_metadata_facts WHERE source_file_id=1),
                (SELECT count(*) FROM source_checkpoints
                   WHERE source_file_id=1 AND consumer_kind='metadata')
             FROM source_files WHERE source_file_id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(durable, (None, 0, 0));
}

fn uuid7(timestamp_ms: u64, suffix: u8) -> String {
    let mut bytes = [0_u8; 16];
    for (index, byte) in bytes[..6].iter_mut().enumerate() {
        *byte = ((timestamp_ms >> (8 * (5 - index))) & 0xff) as u8;
    }
    bytes[6] = 0x70;
    bytes[8] = 0x80;
    bytes[15] = suffix;
    Uuid::from_bytes(bytes).to_string()
}

fn write_rollout(path: &Path, child: &str, parent: &str, parent_turn: &str, cwd: &Path) {
    let records = [
        json!({
            "type": "session_meta",
            "timestamp": "2026-08-08T01:02:03Z",
            "payload": {
                "id": child,
                "timestamp": "2026-08-08T01:02:03Z",
                "cwd": cwd.to_str().unwrap(),
                "agent_role": "main"
            }
        }),
        json!({
            "type": "session_meta",
            "payload": {"id": parent}
        }),
        json!({
            "type": "turn_context",
            "payload": {"turn_id": parent_turn, "model": "parent-model"}
        }),
        json!({
            "type": "event_msg",
            "payload": {"type": "token_count"}
        }),
    ];
    let mut bytes = Vec::new();
    for record in records {
        bytes.extend(serde_json::to_vec(&record).unwrap());
        bytes.push(b'\n');
    }
    fs::write(path, bytes).expect("write replay-tail rollout");
}

fn write_state(home: &Path, rollout_path: &Path, child: &str, cwd: &Path) {
    let connection = Connection::open(home.join("state_5.sqlite")).expect("create state fixture");
    connection
        .execute_batch(
            "CREATE TABLE threads (
                id TEXT NOT NULL,
                rollout_path TEXT,
                created_at_ms INTEGER,
                updated_at_ms INTEGER,
                archived INTEGER,
                cwd TEXT,
                title TEXT,
                name TEXT,
                model TEXT,
                agent_role TEXT
            );
            CREATE TABLE thread_spawn_edges (
                parent_thread_id TEXT NOT NULL,
                child_thread_id TEXT NOT NULL,
                status TEXT,
                observed_at_ms INTEGER
            );",
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO threads (
                id, rollout_path, created_at_ms, updated_at_ms,
                archived, cwd, title, name, model, agent_role
             ) VALUES (?1, ?2, 1700000000000, 1700000000100,
                       0, ?3, 'Replay tail', NULL, 'state-model', 'main')",
            params![child, rollout_path.to_str().unwrap(), cwd.to_str().unwrap()],
        )
        .unwrap();
}

fn write_session_index(home: &Path, child: &str) {
    let value = json!({
        "id": child,
        "thread_name": "Replay tail",
        "updated_at": "2026-08-08T01:02:05Z"
    });
    let mut bytes = serde_json::to_vec(&value).unwrap();
    bytes.push(b'\n');
    fs::write(home.join("session_index.jsonl"), bytes).unwrap();
}

fn wait_for_startup(ledger: &Ledger) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let state = ledger.app_state().expect("read scan state").scan;
        if state.last_finished_scan_id.is_some() && state.active_scan_id.is_none() {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for startup scan"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn startup_replay_tail_scan_completes_and_activates_usage() {
    let root = TempRoot::new("scanner-e2e");
    let home = root.path().join("codex");
    let sessions = home.join("sessions");
    let archived = home.join("archived_sessions");
    let cwd = root.path().join("project");
    fs::create_dir_all(&sessions).unwrap();
    fs::create_dir_all(&archived).unwrap();
    fs::create_dir_all(&cwd).unwrap();

    let parent = uuid7(1_000, 1);
    let parent_turn = uuid7(1_500, 2);
    let child = uuid7(2_000, 3);
    let rollout_path = sessions.join(format!("rollout-{child}.jsonl"));
    write_rollout(&rollout_path, &child, &parent, &parent_turn, &cwd);
    write_state(&home, &rollout_path, &child, &cwd);
    write_session_index(&home, &child);

    let db_path = root.path().join("mu.sqlite3");
    let ledger = Arc::new(Ledger::open(LedgerOptions::new(&db_path, &home)).unwrap());
    let handle = ScanCoordinator::start(
        ScanConfig::new(home.clone()),
        Arc::clone(&ledger),
        CodexMetadata::from_home(home),
    )
    .expect("start scanner");
    wait_for_startup(&ledger);

    let scan = ledger.app_state().unwrap().scan;
    assert_eq!(scan.last_finished_scan_result, Some(ScanResult::Completed));
    assert_eq!(scan.last_scan_error_code, None);

    let connection = Connection::open(&db_path).unwrap();
    let metadata: (String, i64, String) = connection
        .query_row(
            "SELECT f.continuation_state, sc.committed_offset, sc.processing_status
             FROM source_files sf
             JOIN rollout_metadata_facts f USING (source_file_id)
             JOIN source_checkpoints sc USING (source_file_id)
             WHERE sf.current_path=?1 AND sc.consumer_kind='metadata'",
            [rollout_path.to_str().unwrap()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(metadata.0, "replayed_ancestor");
    assert_eq!(
        metadata.1,
        fs::metadata(&rollout_path).unwrap().len() as i64
    );
    assert_eq!(metadata.2, "ready");

    let epochs: (i64, Option<i64>, i64) = connection
        .query_row(
            "SELECT usage_active_epoch, usage_build_epoch, usage_parser_version
             FROM app_meta WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert!(
        epochs.0 > 0,
        "replay-tail source must not keep active epoch at zero"
    );
    assert_eq!(epochs.1, None);
    assert_eq!(epochs.2, mini_usage::usage::USAGE_PARSER_VERSION);

    handle.shutdown().unwrap();
}
