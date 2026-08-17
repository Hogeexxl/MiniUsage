from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load(path): return (ROOT / path).read_text(encoding='utf-8')
def save(path, text): (ROOT / path).write_text(text, encoding='utf-8')
def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# Schema v8: root-level quarantine + exact source-view recovery proof.
# ---------------------------------------------------------------------------
p = 'src/storage/schema/0008_session_resilience.sql'
s = load(p)
s = once(
    s,
    '''CREATE TABLE usage_session_quarantine (
    ledger_epoch INTEGER NOT NULL CHECK (ledger_epoch > 0),
    root_session_id TEXT NOT NULL CHECK (length(root_session_id) > 0),
    primary_error_code TEXT NOT NULL CHECK (length(primary_error_code) > 0),
    first_seen_at_ms INTEGER NOT NULL CHECK (first_seen_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    PRIMARY KEY (ledger_epoch, root_session_id),
    FOREIGN KEY (root_session_id) REFERENCES threads(thread_id)
);
CREATE INDEX usage_session_quarantine_epoch_idx ON usage_session_quarantine(ledger_epoch);
''',
    '''CREATE TABLE usage_session_quarantine (
    ledger_epoch INTEGER NOT NULL CHECK (ledger_epoch > 0),
    root_session_id TEXT NOT NULL CHECK (length(root_session_id) > 0),
    primary_error_code TEXT NOT NULL CHECK (length(primary_error_code) > 0),
    last_activity_at_ms INTEGER NOT NULL CHECK (last_activity_at_ms >= 0),
    first_seen_at_ms INTEGER NOT NULL CHECK (first_seen_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    PRIMARY KEY (ledger_epoch, root_session_id),
    FOREIGN KEY (root_session_id) REFERENCES threads(thread_id)
);
CREATE INDEX usage_session_quarantine_epoch_idx ON usage_session_quarantine(ledger_epoch);

CREATE TABLE usage_session_quarantine_sources (
    ledger_epoch INTEGER NOT NULL CHECK (ledger_epoch > 0),
    root_session_id TEXT NOT NULL CHECK (length(root_session_id) > 0),
    source_file_id INTEGER NOT NULL CHECK (source_file_id > 0),
    file_generation INTEGER NOT NULL CHECK (file_generation > 0),
    device_id INTEGER NOT NULL CHECK (device_id >= 0),
    inode INTEGER NOT NULL CHECK (inode >= 0),
    observed_size INTEGER NOT NULL CHECK (observed_size >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    PRIMARY KEY (ledger_epoch, root_session_id, source_file_id),
    FOREIGN KEY (ledger_epoch, root_session_id)
        REFERENCES usage_session_quarantine(ledger_epoch, root_session_id) ON DELETE CASCADE,
    FOREIGN KEY (source_file_id) REFERENCES source_files(source_file_id)
);
CREATE INDEX usage_session_quarantine_sources_source_idx
    ON usage_session_quarantine_sources(ledger_epoch, source_file_id);
''',
    'schema quarantine tables',
)
save(p, s)

# ---------------------------------------------------------------------------
# Rebuild protocol: Quarantined is a valid terminal build disposition.
# ---------------------------------------------------------------------------
p = 'src/usage/rebuild.rs'
s = load(p)
s = once(
    s,
    '''pub enum CompletionStatus {
    Pending,
    Rebuilt,
    Carried,
    Blocked,
}
''',
    '''pub enum CompletionStatus {
    Pending,
    Rebuilt,
    Carried,
    Blocked,
    Quarantined,
}
''',
    'completion enum',
)
s = once(
    s,
    '''            "blocked" => Ok(Self::Blocked),
            _ => Err(RebuildError::Invalid("unknown completion status")),''',
    '''            "blocked" => Ok(Self::Blocked),
            "quarantined" => Ok(Self::Quarantined),
            _ => Err(RebuildError::Invalid("unknown completion status")),''',
    'completion parse',
)
# ReplayedAncestor is also a valid completed source proof after Track R.
s = s.replace("AND st.continuation_state='owning_live'", "AND st.continuation_state IN ('replayed_ancestor','owning_live')")

# Quarantined source cannot record ordinary progress.
s = once(
    s,
    '''        if member.completion_status == CompletionStatus::Blocked {
            return Err(RebuildError::Cas("blocked source cannot record progress"));
        }
        if member.completion_status == CompletionStatus::Carried {''',
    '''        if matches!(
            member.completion_status,
            CompletionStatus::Blocked | CompletionStatus::Quarantined
        ) {
            return Err(RebuildError::Cas("blocked/quarantined source cannot record progress"));
        }
        if member.completion_status == CompletionStatus::Carried {''',
    'record progress terminal guard',
)

# Add root-level quarantine/recovery methods before retry_blocked.
anchor = '    pub fn retry_blocked(&mut self, source_file_id: i64, now_ms: i64) -> Result<(), RebuildError> {'
if anchor not in s:
    raise SystemExit('retry_blocked anchor missing')
methods = r'''    /// Remove every build contribution for one Session Tree and mark all of its
    /// manifest members as quarantined. The build can still activate, but the
    /// quarantined root contributes no usage rows to that epoch.
    pub fn quarantine_session(
        &mut self,
        root_session_id: &str,
        error_code: &str,
        now_ms: i64,
    ) -> Result<usize, RebuildError> {
        if root_session_id.is_empty() || error_code.is_empty() || now_ms < 0 {
            return Err(RebuildError::Invalid("invalid session quarantine details"));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (build_epoch, target_parser) = current_build(&transaction)?;
        let mut statement = transaction.prepare(
            "SELECT source_file_id,expected_file_generation,expected_device_id,expected_inode,observed_raw_size
             FROM usage_build_sources
             WHERE build_epoch=?1 AND expected_root_session_id=?2
             ORDER BY source_file_id",
        )?;
        let members = statement
            .query_map(params![build_epoch, root_session_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, u64>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        if members.is_empty() {
            return Err(RebuildError::Cas("session has no build members"));
        }

        let last_activity_at_ms: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(COALESCE(updated_at_ms,created_at_ms,0)),0)
             FROM threads WHERE thread_id=?1 OR root_session_id=?1",
            [root_session_id],
            |row| row.get(0),
        )?;

        transaction.execute(
            "INSERT INTO usage_session_quarantine(
                ledger_epoch,root_session_id,primary_error_code,last_activity_at_ms,
                first_seen_at_ms,updated_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?5)
             ON CONFLICT(ledger_epoch,root_session_id) DO UPDATE SET
                primary_error_code=excluded.primary_error_code,
                last_activity_at_ms=MAX(usage_session_quarantine.last_activity_at_ms,excluded.last_activity_at_ms),
                updated_at_ms=excluded.updated_at_ms",
            params![build_epoch, root_session_id, error_code, last_activity_at_ms, now_ms],
        )?;
        transaction.execute(
            "DELETE FROM usage_session_quarantine_sources
             WHERE ledger_epoch=?1 AND root_session_id=?2",
            params![build_epoch, root_session_id],
        )?;

        for (source_file_id, generation, device_id, inode, observed_size) in &members {
            cleanup_build_source(&transaction, build_epoch, *source_file_id)?;
            reset_checkpoint(&transaction, *source_file_id, target_parser)?;
            let changed = transaction.execute(
                "UPDATE usage_build_sources SET
                    completion_status='quarantined',completion_error_code=?1,
                    completed_generation=NULL,completed_through_offset=NULL,
                    carry_from_epoch=NULL,carry_phase='none',carry_after_start_offset=NULL,
                    carry_after_turn_key=NULL,carry_after_anomaly_id=NULL,updated_at_ms=?2
                 WHERE build_epoch=?3 AND source_file_id=?4
                   AND expected_root_session_id=?5",
                params![error_code, now_ms, build_epoch, source_file_id, root_session_id],
            )?;
            if changed != 1 {
                return Err(RebuildError::Cas("session quarantine manifest CAS failed"));
            }
            transaction.execute(
                "INSERT INTO usage_session_quarantine_sources(
                    ledger_epoch,root_session_id,source_file_id,file_generation,
                    device_id,inode,observed_size,updated_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    build_epoch,
                    root_session_id,
                    source_file_id,
                    generation,
                    device_id,
                    inode,
                    observed_size,
                    now_ms,
                ],
            )?;
        }

        let leaked: i64 = transaction.query_row(
            "SELECT
                (SELECT count(*) FROM usage_events WHERE ledger_epoch=?1 AND root_session_id=?2)
              + (SELECT count(*) FROM turns WHERE ledger_epoch=?1 AND thread_id IN (
                    SELECT thread_id FROM threads WHERE root_session_id=?2 OR thread_id=?2))
              + (SELECT count(*) FROM usage_source_states WHERE ledger_epoch=?1 AND root_session_id=?2)",
            params![build_epoch, root_session_id],
            |row| row.get(0),
        )?;
        if leaked != 0 {
            return Err(RebuildError::Cas("quarantined session still has build usage rows"));
        }
        transaction.commit()?;
        Ok(members.len())
    }

    /// Return the unchanged active quarantine source IDs and whether at least
    /// one quarantined Session Tree has changed and therefore needs a shadow retry.
    pub fn active_quarantine_state(&mut self) -> Result<ActiveQuarantineState, RebuildError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let active_epoch: i64 = transaction.query_row(
            "SELECT usage_active_epoch FROM app_meta WHERE id=1",
            [],
            |row| row.get(0),
        )?;
        if active_epoch == 0 {
            transaction.commit()?;
            return Ok(ActiveQuarantineState::default());
        }
        let mut roots_statement = transaction.prepare(
            "SELECT root_session_id FROM usage_session_quarantine
             WHERE ledger_epoch=?1 ORDER BY root_session_id",
        )?;
        let roots = roots_statement
            .query_map([active_epoch], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(roots_statement);

        let mut state = ActiveQuarantineState::default();
        for root in roots {
            let mut proof_statement = transaction.prepare(
                "SELECT source_file_id,file_generation,device_id,inode,observed_size
                 FROM usage_session_quarantine_sources
                 WHERE ledger_epoch=?1 AND root_session_id=?2 ORDER BY source_file_id",
            )?;
            let proofs = proof_statement
                .query_map(params![active_epoch, root], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, u64>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            drop(proof_statement);
            let proof_ids = proofs.iter().map(|proof| proof.0).collect::<BTreeSet<_>>();
            let present_ids = query_ids_string(
                &transaction,
                "SELECT sf.source_file_id
                 FROM source_files sf JOIN threads t ON t.thread_id=sf.thread_id
                 WHERE sf.file_status='present' AND t.root_session_id=?1
                 ORDER BY sf.source_file_id",
                &root,
            )?
            .into_iter()
            .collect::<BTreeSet<_>>();
            let mut clean = proof_ids == present_ids && !proofs.is_empty();
            if clean {
                for (source_id, generation, device_id, inode, observed_size) in &proofs {
                    let matches: i64 = transaction.query_row(
                        "SELECT count(*) FROM source_files
                         WHERE source_file_id=?1 AND file_status='present'
                           AND file_generation=?2 AND device_id=?3 AND inode=?4 AND observed_size=?5",
                        params![source_id, generation, device_id, inode, observed_size],
                        |row| row.get(0),
                    )?;
                    if matches != 1 {
                        clean = false;
                        break;
                    }
                }
            }
            if clean {
                state.unchanged_source_ids.extend(proof_ids);
            } else {
                state.dirty = true;
            }
        }
        state.unchanged_source_ids.sort_unstable();
        state.unchanged_source_ids.dedup();
        transaction.commit()?;
        Ok(state)
    }

'''
s = s.replace(anchor, methods + anchor, 1)

# Activation accepts quarantined members and validates their proof instead of usage state.
s = once(
    s,
    '''             WHERE build_epoch=?1 AND completion_status NOT IN ('rebuilt','carried')",''',
    '''             WHERE build_epoch=?1 AND completion_status NOT IN ('rebuilt','carried','quarantined')",''',
    'activation terminal statuses',
)
s = once(
    s,
    '''        for source_file_id in member_ids {
            verify_completion_row_for_storage(&transaction, build_epoch, source_file_id)?;
        }
''',
    '''        for source_file_id in member_ids {
            let status: String = transaction.query_row(
                "SELECT completion_status FROM usage_build_sources
                 WHERE build_epoch=?1 AND source_file_id=?2",
                params![build_epoch, source_file_id],
                |row| row.get(0),
            )?;
            if status == "quarantined" {
                verify_quarantined_source(&transaction, build_epoch, source_file_id)?;
            } else {
                verify_completion_row_for_storage(&transaction, build_epoch, source_file_id)?;
            }
        }
''',
    'activation verification',
)

# Add public state model after ActivationOutcome.
s = once(
    s,
    '''pub struct ActivationOutcome {
    pub active_epoch: i64,
    pub data_revision: i64,
}
''',
    '''pub struct ActivationOutcome {
    pub active_epoch: i64,
    pub data_revision: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActiveQuarantineState {
    pub unchanged_source_ids: Vec<i64>,
    pub dirty: bool,
}
''',
    'active quarantine state model',
)

# Add verification + string query helper before verify_completion_row_for_storage.
anchor = 'pub(crate) fn verify_completion_row_for_storage('
if anchor not in s:
    raise SystemExit('completion verify anchor missing')
helpers = r'''fn verify_quarantined_source(
    transaction: &Transaction<'_>,
    build_epoch: i64,
    source_file_id: i64,
) -> Result<(), RebuildError> {
    let valid: i64 = transaction.query_row(
        "SELECT count(*)
         FROM usage_build_sources b
         JOIN usage_session_quarantine q
           ON q.ledger_epoch=b.build_epoch AND q.root_session_id=b.expected_root_session_id
         JOIN usage_session_quarantine_sources qs
           ON qs.ledger_epoch=b.build_epoch
          AND qs.root_session_id=b.expected_root_session_id
          AND qs.source_file_id=b.source_file_id
         WHERE b.build_epoch=?1 AND b.source_file_id=?2
           AND b.completion_status='quarantined'
           AND b.completion_error_code=q.primary_error_code
           AND qs.file_generation=b.expected_file_generation
           AND qs.device_id=b.expected_device_id AND qs.inode=b.expected_inode
           AND qs.observed_size=b.observed_raw_size
           AND NOT EXISTS (
               SELECT 1 FROM usage_event_occurrences o
               WHERE o.ledger_epoch=b.build_epoch AND o.source_file_id=b.source_file_id)
           AND NOT EXISTS (
               SELECT 1 FROM turns t
               WHERE t.ledger_epoch=b.build_epoch AND t.source_file_id=b.source_file_id)
           AND NOT EXISTS (
               SELECT 1 FROM usage_source_states st
               WHERE st.ledger_epoch=b.build_epoch AND st.source_file_id=b.source_file_id)",
        params![build_epoch, source_file_id],
        |row| row.get(0),
    )?;
    if valid != 1 {
        return Err(RebuildError::Cas("quarantined source proof is stale"));
    }
    Ok(())
}

fn query_ids_string(
    transaction: &Transaction<'_>,
    sql: &str,
    value: &str,
) -> Result<Vec<i64>, RebuildError> {
    let mut statement = transaction.prepare(sql)?;
    let rows = statement.query_map([value], |row| row.get::<_, i64>(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

'''
s = s.replace(anchor, helpers + anchor, 1)
save(p, s)

# ---------------------------------------------------------------------------
# Storage planner: understand Quarantined and zero-body skip unchanged active roots.
# ---------------------------------------------------------------------------
p = 'src/storage/usage.rs'
s = load(p)
s = once(
    s,
    '''pub(crate) enum UsageBuildCompletion {
    Pending,
    Rebuilt,
    Carried,
    Blocked,
}
''',
    '''pub(crate) enum UsageBuildCompletion {
    Pending,
    Rebuilt,
    Carried,
    Blocked,
    Quarantined,
}
''',
    'storage build completion enum',
)
s = once(
    s,
    '''                    "blocked" => UsageBuildCompletion::Blocked,
                    _ => return Err(rusqlite::Error::InvalidParameterName("invalid build completion".to_owned())),''',
    '''                    "blocked" => UsageBuildCompletion::Blocked,
                    "quarantined" => UsageBuildCompletion::Quarantined,
                    _ => return Err(rusqlite::Error::InvalidParameterName("invalid build completion".to_owned())),''',
    'storage completion parse',
)
s = once(
    s,
    '''            UsageBuildCompletion::Rebuilt | UsageBuildCompletion::Carried
        )
    {
        plan.action = UsagePlanAction::Skip;''',
    '''            UsageBuildCompletion::Rebuilt
                | UsageBuildCompletion::Carried
                | UsageBuildCompletion::Quarantined
        )
    {
        plan.action = UsagePlanAction::Skip;''',
    'planner terminal skip',
)
# Stable worklist excludes exact unchanged active quarantine proofs.
s = once(
    s,
    '''           AND th.root_session_id IS NOT NULL
           AND (cp.source_file_id IS NULL OR NOT (''',
    '''           AND th.root_session_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM usage_session_quarantine_sources qs
               WHERE qs.ledger_epoch=?{epoch_bind}
                 AND qs.source_file_id=sf.source_file_id
                 AND qs.file_generation=sf.file_generation
                 AND qs.device_id=sf.device_id AND qs.inode=sf.inode
                 AND qs.observed_size=sf.observed_size
           )
           AND (cp.source_file_id IS NULL OR NOT (''',
    'stable worklist quarantine skip',
)
# Cleanup inactive health rows in FK-safe child -> parent order.
s = once(
    s,
    '''        let statements = [
            "DELETE FROM usage_event_occurrences WHERE rowid IN (''',
    '''        let statements = [
            "DELETE FROM usage_session_quarantine_sources WHERE rowid IN (
                SELECT rowid FROM usage_session_quarantine_sources
                WHERE ledger_epoch<>?1 AND ledger_epoch<>?2
                ORDER BY ledger_epoch,rowid LIMIT ?3)",
            "DELETE FROM usage_session_quarantine WHERE rowid IN (
                SELECT q.rowid FROM usage_session_quarantine q
                WHERE q.ledger_epoch<>?1 AND q.ledger_epoch<>?2
                  AND NOT EXISTS (
                    SELECT 1 FROM usage_session_quarantine_sources qs
                    WHERE qs.ledger_epoch=q.ledger_epoch AND qs.root_session_id=q.root_session_id)
                ORDER BY q.ledger_epoch,q.rowid LIMIT ?3)",
            "DELETE FROM usage_event_occurrences WHERE rowid IN (''',
    'inactive quarantine cleanup',
)
save(p, s)

# ---------------------------------------------------------------------------
# Usage facade exposes quarantine transition/state.
# ---------------------------------------------------------------------------
p = 'src/usage/ledger.rs'
s = load(p)
s = once(
    s,
    '''    rebuild::{ActivationOutcome, BuildSnapshot, RebuildError, RebuildLedger},''',
    '''    rebuild::{
        ActiveQuarantineState, ActivationOutcome, BuildSnapshot, RebuildError, RebuildLedger,
    },''',
    'ledger rebuild imports',
)
anchor = '''    pub fn activate_rebuild(
        &self,
        build_epoch: i64,
        complete_present_source_ids: &[i64],
    ) -> Result<ActivationOutcome, UsageLedgerError> {'''
if anchor not in s:
    raise SystemExit('ledger activate anchor missing')
methods = r'''    pub fn quarantine_thread(
        &self,
        thread_id: &str,
        error_code: &str,
        now_ms: i64,
    ) -> Result<usize, UsageLedgerError> {
        let mut connection = self.ledger.connection()?;
        let root: Option<String> = connection
            .query_row(
                "SELECT root_session_id FROM threads WHERE thread_id=?1",
                [thread_id],
                |row| row.get(0),
            )
            .map_err(storage::StorageError::sqlite)?;
        let root = root.ok_or(UsageLedgerError::Invalid("thread has no root session"))?;
        Ok(RebuildLedger::new(&mut connection).quarantine_session(&root, error_code, now_ms)?)
    }

    pub fn active_quarantine_state(&self) -> Result<ActiveQuarantineState, UsageLedgerError> {
        let mut connection = self.ledger.connection()?;
        Ok(RebuildLedger::new(&mut connection).active_quarantine_state()?)
    }

'''
s = s.replace(anchor, methods + anchor, 1)
save(p, s)

# ---------------------------------------------------------------------------
# Scanner: dirty quarantine retries in shadow build; blocked relationships are
# Session-data failures and get isolated instead of blocking all activation.
# ---------------------------------------------------------------------------
p = 'src/scanner/usage_consumer.rs'
s = load(p)
s = once(
    s,
    '''enum UsageThreadOutcome {
    Completed,
    GlobalPlanChanged { retry_thread: bool },
    OrdinaryError(&'static str),
    FatalReloadError(&'static str),
}
''',
    '''enum UsageThreadOutcome {
    Completed,
    GlobalPlanChanged { retry_thread: bool },
    SessionDataError(&'static str),
    OrdinaryError(&'static str),
    FatalReloadError(&'static str),
}
''',
    'thread outcome session data error',
)
# Active quarantine state is evaluated before loading work list.
s = once(
    s,
    '''    let mut worklist = load_work_list(&usage, &present_ids, report, false)?;
    let mut first_group_error = None;''',
    '''    let quarantine_state = usage
        .active_quarantine_state()
        .map_err(|_| "USAGE_QUARANTINE_STATE_FAILED")?;
    let work_present_ids = if quarantine_state.dirty {
        present_ids.clone()
    } else {
        let skipped = quarantine_state
            .unchanged_source_ids
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        present_ids
            .iter()
            .copied()
            .filter(|source_id| !skipped.contains(source_id))
            .collect::<Vec<_>>()
    };
    let mut worklist = load_work_list(&usage, &work_present_ids, report, false)?;
    let mut first_group_error = None;''',
    'initial quarantine worklist',
)
# Dirty active quarantine must retry in a shadow build before any direct active write.
anchor = '''    'global_plan: loop {
        if worklist.epoch.active_epoch == 0 && worklist.epoch.build_epoch.is_none() {'''
replacement = '''    'global_plan: loop {
        if quarantine_state.dirty
            && worklist.epoch.active_epoch > 0
            && worklist.epoch.build_epoch.is_none()
        {
            if !discovery_complete {
                return Ok(());
            }
            usage
                .begin_rebuild(USAGE_PARSER_VERSION, present_ids.iter().copied(), now_ms())
                .map_err(|_| "USAGE_QUARANTINE_RETRY_BEGIN_FAILED")?;
            report.observe_usage_global_replan();
            worklist = load_work_list(&usage, &present_ids, report, true)?;
            skip_thread_ids.clear();
            continue 'global_plan;
        }
        if worklist.epoch.active_epoch == 0 && worklist.epoch.build_epoch.is_none() {'''
s = once(s, anchor, replacement, 'dirty quarantine shadow retry')
# Handle session-data error with root-level quarantine + replan.
s = once(
    s,
    '''                UsageThreadOutcome::OrdinaryError(error_code) => {
                    report.failed_source();
                    report.error(error_code);
                    first_group_error.get_or_insert(error_code);
                }''',
    '''                UsageThreadOutcome::SessionDataError(error_code) => {
                    report.failed_source();
                    report.error(error_code);
                    if worklist.epoch.build_epoch.is_none() {
                        return Err(error_code);
                    }
                    usage
                        .quarantine_thread(&work_thread.thread_id, error_code, now_ms())
                        .map_err(|_| "USAGE_SESSION_QUARANTINE_FAILED")?;
                    report.observe_usage_global_replan();
                    worklist = load_work_list(&usage, &present_ids, report, true)?;
                    skip_thread_ids.clear();
                    continue 'global_plan;
                }
                UsageThreadOutcome::OrdinaryError(error_code) => {
                    report.failed_source();
                    report.error(error_code);
                    first_group_error.get_or_insert(error_code);
                }''',
    'session error branch',
)
# Activation accepts terminal quarantine.
s = once(
    s,
    '''                    member.completion_status,
                    CompletionStatus::Rebuilt | CompletionStatus::Carried
                )''',
    '''                    member.completion_status,
                    CompletionStatus::Rebuilt
                        | CompletionStatus::Carried
                        | CompletionStatus::Quarantined
                )''',
    'scanner activation quarantine status',
)
# A relationship-blocked thread is precisely an isolatable Session data failure.
s = once(
    s,
    '''        if group.is_empty()
            || group.iter().all(|plan| {
                matches!(
                    plan.action,
                    PlanAction::Skip | PlanAction::BlockedRelationship
                )
            })
        {
            return UsageThreadOutcome::Completed;
        }''',
    '''        if group.is_empty() {
            return UsageThreadOutcome::Completed;
        }
        if group.iter().all(|plan| {
            matches!(
                plan.action,
                PlanAction::Skip | PlanAction::BlockedRelationship
            )
        }) {
            return if group
                .iter()
                .any(|plan| plan.action == PlanAction::BlockedRelationship)
            {
                UsageThreadOutcome::SessionDataError("USAGE_SESSION_RELATIONSHIP_INVALID")
            } else {
                UsageThreadOutcome::Completed
            };
        }''',
    'blocked relationship isolation',
)
save(p, s)

print('session quarantine backend patch applied')
