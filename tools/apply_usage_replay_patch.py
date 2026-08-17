from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def load(path):
    return (ROOT / path).read_text(encoding='utf-8')

def save(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: pattern not found')
    if text.count(old) != 1:
        raise SystemExit(f'{label}: expected 1, got {text.count(old)}')
    return text.replace(old, new, 1)

# Usage parser version changes because the durable ownership continuation semantics changed.
p = 'src/usage/normalized.rs'
s = load(p)
s = once(s, 'pub const USAGE_PARSER_VERSION: i64 = 6;', 'pub const USAGE_PARSER_VERSION: i64 = 7;', 'usage parser version')
s = once(
    s,
    '''    match parser_version {
        4 | 5 => Some(4),
        USAGE_PARSER_VERSION => Some(USAGE_CANONICAL_ALGORITHM_VERSION),
        _ => None,
    }''',
    '''    match parser_version {
        4 | 5 => Some(4),
        6 | USAGE_PARSER_VERSION => Some(USAGE_CANONICAL_ALGORITHM_VERSION),
        _ => None,
    }''',
    'canonical mapping',
)
save(p, s)

# Usage pipeline: persist replay/owning phase and allow the scanner to declare
# that an initial fixed view is known (from metadata) to end in replay.
p = 'src/usage/pipeline.rs'
s = load(p)
s = once(
    s,
    '''pub enum CheckpointStatus {
    Pending,
    Ready,
    Error,
    RebuildRequired,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckpointExpectation''',
    '''pub enum CheckpointStatus {
    Pending,
    Ready,
    Error,
    RebuildRequired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceContinuationState {
    ReplayedAncestor,
    OwningLive,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckpointExpectation''',
    'pipeline continuation enum',
)
s = once(
    s,
    '''    pub owning_thread_id: String,
    pub root_session_id: String,
    pub processor_state: UsageSourceState,''',
    '''    pub owning_thread_id: String,
    pub root_session_id: String,
    pub continuation_state: SourceContinuationState,
    pub processor_state: UsageSourceState,''',
    'source proof continuation',
)
s = once(
    s,
    '''    pub state: Option<SourceStateProof>,
    pub replayed_prefix_bytes_before_chunk: u64,''',
    '''    pub state: Option<SourceStateProof>,
    /// True only when the metadata safe fact for this exact fixed view proves
    /// that a newly established owner legitimately ends while replaying an ancestor.
    pub allow_replay_tail: bool,
    pub replayed_prefix_bytes_before_chunk: u64,''',
    'pipeline replay-tail proof',
)

# Normal nonzero processing: a replay continuation may skip replay records and
# later transition back to owning; an OwningLive continuation still rejects replay.
old = '''        let original_state = plan
            .state
            .as_ref()
            .ok_or(PipelineError::InvalidPlan)?
            .processor_state
            .clone();'''
new = '''        let original_proof = plan.state.as_ref().ok_or(PipelineError::InvalidPlan)?;
        let original_state = original_proof.processor_state.clone();
        let mut continuation_state = original_proof.continuation_state;'''
s = once(s, old, new, 'pipeline original proof')
old = '''            if item.classification().ownership != RecordOwnership::Owning {
                return Ok(PipelineDisposition::NeedsRebuild);
            }
            let start = item.start_offset();
            let end = item.end_offset();
            let line_bytes = end - start;
            let oversized = matches!(item, ClassifiedUsageItem::Oversized(_));
            if !fits_line_budget(
                last_complete_offset - plan.start_offset,
                complete_line_count,
                line_bytes,
                oversized,
            ) {
                break;
            }
            let record = match &item {'''
new = '''            let start = item.start_offset();
            let end = item.end_offset();
            let line_bytes = end - start;
            let oversized = matches!(item, ClassifiedUsageItem::Oversized(_));
            if !fits_line_budget(
                last_complete_offset - plan.start_offset,
                complete_line_count,
                line_bytes,
                oversized,
            ) {
                break;
            }
            match item.classification().ownership {
                RecordOwnership::UnknownOwnership => {
                    return Ok(PipelineDisposition::NeedsRebuild);
                }
                RecordOwnership::ReplayedAncestor => {
                    if continuation_state != SourceContinuationState::ReplayedAncestor {
                        return Ok(PipelineDisposition::NeedsRebuild);
                    }
                    complete_line_count += 1;
                    last_complete_offset = end;
                    if oversized {
                        break;
                    }
                    continue;
                }
                RecordOwnership::Owning => {
                    continuation_state = SourceContinuationState::OwningLive;
                }
            }
            let record = match &item {'''
s = once(s, old, new, 'pipeline nonzero replay handling')
# Add continuation arg to the normal commit.
s = once(
    s,
    '''            committed_at_ms,
            active_model_offset,
            active_reasoning_effort_offset,
        )))''',
    '''            committed_at_ms,
            active_model_offset,
            active_reasoning_effort_offset,
            continuation_state,
        )))''',
    'normal commit continuation',
)

# Replace ownership establishment with a stateful implementation. For ordinary
# sources it preserves the old one-boundary empty commit; only metadata-proven
# replay-tail sources continue through the fixed view.
start = s.index('fn establish_ownership<I>(')
end = s.index('\nfn process_local_replay<I>(', start)
new_fn = r'''fn establish_ownership<I>(
    plan: UsagePipelinePlan,
    owning_thread_id: &str,
    root_session_id: &str,
    lines: &mut std::iter::Peekable<I>,
    next_guard_hash: Option<Vec<u8>>,
    committed_at_ms: i64,
) -> Result<PipelineDisposition, PipelineError>
where
    I: Iterator<Item = ClassifiedUsageItem>,
{
    let context = UsageContext {
        source_file_id: plan.source_file_id,
        file_generation: plan.file_generation,
        owning_thread_id: owning_thread_id.to_owned(),
        root_session_id: root_session_id.to_owned(),
    };
    let adapter = CodexRolloutParser;
    let mut state = UsageSourceState::default();
    let mut active_model_offset = None;
    let mut active_reasoning_effort_offset = None;
    let mut events = Vec::new();
    let mut occurrences = Vec::new();
    let mut anomalies = Vec::new();
    let mut closed_turns = Vec::new();
    let mut last = plan.read_start_offset;
    let mut replayed_bytes = plan.replayed_prefix_bytes_before_chunk;
    let mut replayed_lines = plan.replayed_prefix_lines_before_chunk;
    let mut complete_line_count = replayed_lines;
    let mut ownership_established = false;
    let mut continuation_state = SourceContinuationState::OwningLive;

    while let Some(item) = lines.next() {
        if !matching_item(&item, last, plan.fixed_observed_size) {
            return Ok(PipelineDisposition::NeedsRebuild);
        }
        let start = item.start_offset();
        let end = item.end_offset();
        let bytes = end - start;
        let oversized = matches!(item, ClassifiedUsageItem::Oversized(_));

        if !ownership_established {
            match item.classification().ownership {
                RecordOwnership::ReplayedAncestor => {
                    replayed_bytes = replayed_bytes.saturating_add(bytes);
                    replayed_lines = replayed_lines.saturating_add(1);
                    complete_line_count = complete_line_count.saturating_add(1);
                    last = end;
                    continue;
                }
                RecordOwnership::UnknownOwnership => {
                    return Ok(PipelineDisposition::AwaitingOwningMeta);
                }
                RecordOwnership::Owning => {
                    let ClassifiedUsageItem::Line(line) = &item else {
                        return Ok(PipelineDisposition::AwaitingOwningMeta);
                    };
                    if !matches!(
                        line.classification.envelope,
                        EnvelopeKind::SessionMeta | EnvelopeKind::TurnContext
                    ) {
                        return Ok(PipelineDisposition::AwaitingOwningMeta);
                    }
                    ownership_established = true;
                    continuation_state = SourceContinuationState::OwningLive;
                }
            }
        } else {
            match item.classification().ownership {
                RecordOwnership::UnknownOwnership => {
                    return Ok(PipelineDisposition::NeedsRebuild);
                }
                RecordOwnership::ReplayedAncestor => {
                    if !plan.allow_replay_tail {
                        return Ok(PipelineDisposition::NeedsRebuild);
                    }
                    continuation_state = SourceContinuationState::ReplayedAncestor;
                    replayed_bytes = replayed_bytes.saturating_add(bytes);
                    replayed_lines = replayed_lines.saturating_add(1);
                    complete_line_count = complete_line_count.saturating_add(1);
                    last = end;
                    if oversized {
                        break;
                    }
                    continue;
                }
                RecordOwnership::Owning => {
                    continuation_state = SourceContinuationState::OwningLive;
                }
            }
        }

        if !fits_line_budget(
            last.saturating_sub(plan.start_offset).saturating_sub(replayed_bytes),
            complete_line_count.saturating_sub(replayed_lines),
            bytes,
            oversized,
        ) {
            break;
        }
        let raw = match &item {
            ClassifiedUsageItem::Line(value) => adapter.parse_line(&value.line),
            ClassifiedUsageItem::Oversized(_) => UsageRawRecord::OversizedComplete {
                start_offset: start,
                end_offset: end,
            },
        };
        if let Some(record) = normalized_record(raw, owning_thread_id, start, end) {
            let context_record = match &record {
                UsageRecord::TurnContext { model, reasoning_effort, .. } => {
                    Some((model.is_some(), reasoning_effort.is_some()))
                }
                _ => None,
            };
            let processed = UsageProcessor::new(context.clone(), Some(state.clone())).process([record]);
            if processed.needs_rebuild
                || occurrences.len() + processed.occurrences.len() > MAX_BATCH_CANDIDATES as usize
            {
                return Ok(PipelineDisposition::NeedsRebuild);
            }
            state = processed.updated_state;
            if let Some((has_model, has_effort)) = context_record {
                if has_model {
                    active_model_offset = Some(start);
                }
                active_reasoning_effort_offset = has_effort.then_some(start);
            }
            events.extend(processed.events);
            occurrences.extend(processed.occurrences);
            anomalies.extend(processed.anomalies);
            closed_turns.extend(processed.closed_turns);
        }
        complete_line_count = complete_line_count.saturating_add(1);
        last = end;

        // Preserve the historical empty ownership-boundary commit for normal
        // sources. The extended path is entered only for metadata-proven replay EOF.
        if !plan.allow_replay_tail {
            return Ok(PipelineDisposition::Commit(commit_dto(
                plan,
                owning_thread_id.to_owned(),
                root_session_id.to_owned(),
                ProcessResult {
                    events,
                    occurrences,
                    anomalies,
                    closed_turns,
                    updated_state: state,
                    needs_rebuild: false,
                },
                last,
                complete_line_count,
                replayed_bytes,
                replayed_lines,
                FixedViewTail {
                    exhausted: false,
                    status: TailStatus::Unverified,
                    half_line_start: None,
                },
                next_guard_hash,
                committed_at_ms,
                active_model_offset,
                active_reasoning_effort_offset,
                SourceContinuationState::OwningLive,
            )));
        }
    }

    if !ownership_established {
        return Ok(PipelineDisposition::AwaitingOwningMeta);
    }
    let tail = FixedViewTail {
        exhausted: last == plan.fixed_observed_size,
        status: if last == plan.fixed_observed_size { TailStatus::None } else { TailStatus::Unverified },
        half_line_start: None,
    };
    Ok(PipelineDisposition::Commit(commit_dto(
        plan,
        owning_thread_id.to_owned(),
        root_session_id.to_owned(),
        ProcessResult {
            events,
            occurrences,
            anomalies,
            closed_turns,
            updated_state: state,
            needs_rebuild: false,
        },
        last,
        complete_line_count,
        replayed_bytes,
        replayed_lines,
        tail,
        next_guard_hash,
        committed_at_ms,
        active_model_offset,
        active_reasoning_effort_offset,
        continuation_state,
    )))
}
'''
s = s[:start] + new_fn + s[end:]

# Local replay also accepts a metadata-proven replay tail and persists its phase.
s = once(
    s,
    '''    let mut adapter_bytes = 0u64;
    let mut ownership_established = false;''',
    '''    let mut adapter_bytes = 0u64;
    let mut ownership_established = false;
    let mut continuation_state = SourceContinuationState::OwningLive;''',
    'local replay continuation init',
)
s = once(
    s,
    '''        } else if item.classification().ownership != RecordOwnership::Owning {
            return Ok(PipelineDisposition::NeedsRebuild);
        }

        let oversized = matches!(item, ClassifiedUsageItem::Oversized(_));''',
    '''        } else {
            match item.classification().ownership {
                RecordOwnership::UnknownOwnership => return Ok(PipelineDisposition::NeedsRebuild),
                RecordOwnership::ReplayedAncestor => {
                    if !plan.allow_replay_tail {
                        return Ok(PipelineDisposition::NeedsRebuild);
                    }
                    continuation_state = SourceContinuationState::ReplayedAncestor;
                    replayed_bytes = replayed_bytes.saturating_add(bytes);
                    replayed_lines = replayed_lines.saturating_add(1);
                    last = end;
                    continue;
                }
                RecordOwnership::Owning => {
                    continuation_state = SourceContinuationState::OwningLive;
                }
            }
        }

        let oversized = matches!(item, ClassifiedUsageItem::Oversized(_));''',
    'local replay replay-tail handling',
)
# local replay commit call has same ending pattern but normal was already replaced; target around function tail uniquely.
needle = '''        committed_at_ms,
        active_model_offset,
        active_reasoning_effort_offset,
    )))
}

fn matching_item'''
s = once(
    s,
    needle,
    '''        committed_at_ms,
        active_model_offset,
        active_reasoning_effort_offset,
        continuation_state,
    )))
}

fn matching_item''',
    'local replay commit continuation',
)

# commit_dto accepts and persists continuation.
s = once(
    s,
    '''    active_model_offset: Option<u64>,
    active_reasoning_effort_offset: Option<u64>,
) -> UsageSourceCommitDto {''',
    '''    active_model_offset: Option<u64>,
    active_reasoning_effort_offset: Option<u64>,
    continuation_state: SourceContinuationState,
) -> UsageSourceCommitDto {''',
    'commit dto signature',
)
s = once(
    s,
    '''        owning_thread_id: owning_thread_id.clone(),
        root_session_id: root_session_id.clone(),
        processor_state: result.updated_state.clone(),''',
    '''        owning_thread_id: owning_thread_id.clone(),
        root_session_id: root_session_id.clone(),
        continuation_state,
        processor_state: result.updated_state.clone(),''',
    'commit dto persisted continuation',
)
# Test plan defaults to owning continuation and no replay-tail proof.
s = once(
    s,
    '''                owning_thread_id: OWNER.to_owned(),
                root_session_id: ROOT.to_owned(),
                processor_state,''',
    '''                owning_thread_id: OWNER.to_owned(),
                root_session_id: ROOT.to_owned(),
                continuation_state: SourceContinuationState::OwningLive,
                processor_state,''',
    'pipeline test source state continuation',
)
s = once(
    s,
    '''            state: (start > 0).then(|| SourceStateProof {''',
    '''            state: (start > 0).then(|| SourceStateProof {''',
    'pipeline test plan state anchor',
)
# add allow_replay_tail immediately after state block by stable following marker
s = once(
    s,
    '''            }),
            replayed_prefix_bytes_before_chunk: 0,
            replayed_prefix_lines_before_chunk: 0,
        }
    }''',
    '''            }),
            allow_replay_tail: false,
            replayed_prefix_bytes_before_chunk: 0,
            replayed_prefix_lines_before_chunk: 0,
        }
    }''',
    'pipeline test allow replay tail',
)
save(p, s)

# Storage usage state now carries a real replay/owning phase.
p = 'src/storage/usage.rs'
s = load(p)
s = once(
    s,
    '''pub(crate) enum UsageChainState {
    Continuous,
    Interrupted(UsageGapReason),
}
''',
    '''pub(crate) enum UsageChainState {
    Continuous,
    Interrupted(UsageGapReason),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UsageContinuationState {
    ReplayedAncestor,
    OwningLive,
}

impl UsageContinuationState {
    const fn as_str(self) -> &'static str {
        match self {
            Self::ReplayedAncestor => "replayed_ancestor",
            Self::OwningLive => "owning_live",
        }
    }

    fn parse(value: &str) -> StorageResult<Self> {
        match value {
            "replayed_ancestor" => Ok(Self::ReplayedAncestor),
            "owning_live" => Ok(Self::OwningLive),
            _ => Err(StorageError::invalid_state("invalid usage continuation state")),
        }
    }
}
''',
    'storage continuation enum',
)
s = once(
    s,
    '''    pub owning_thread_id: String,
    pub root_session_id: String,
    pub previous_total: Option<UsageSnapshot>,''',
    '''    pub owning_thread_id: String,
    pub root_session_id: String,
    pub continuation_state: UsageContinuationState,
    pub previous_total: Option<UsageSnapshot>,''',
    'storage state continuation field',
)
# Completion proof accepts either safe durable phase.
s = s.replace("AND st.continuation_state='owning_live'", "AND st.continuation_state IN ('replayed_ancestor','owning_live')")

# Replace the full read state function to avoid index drift.
start = s.index('fn read_usage_source_state(')
end = s.index('\nfn read_open_turn(', start)
read_fn = r'''fn read_usage_source_state(
    transaction: &Transaction<'_>,
    epoch: i64,
    source_file_id: i64,
) -> StorageResult<Option<UsageSourceStateWrite>> {
    transaction
        .query_row(
            "SELECT file_generation,device_id,inode,usage_parser_version,
                canonical_algorithm_version,resolved_through_offset,observed_raw_size,
                raw_tail_status,raw_tail_start_offset,owning_thread_id,root_session_id,continuation_state,
                previous_total_input_tokens,previous_total_cached_tokens,
                previous_total_cache_write_tokens,previous_total_output_tokens,
                previous_total_reasoning_tokens,previous_total_total_tokens,previous_total_fingerprint,
                previous_total_offset,chain_state,chain_block_reason,active_turn_key,
                active_model,active_model_offset,active_reasoning_effort,active_reasoning_effort_offset,updated_at_ms
             FROM usage_source_states WHERE ledger_epoch=?1 AND source_file_id=?2",
            params![epoch, source_file_id],
            |row| {
                let tail: String = row.get(7)?;
                let continuation: String = row.get(11)?;
                let chain: String = row.get(20)?;
                let reason: Option<String> = row.get(21)?;
                let previous_input: Option<i64> = row.get(12)?;
                let previous_total = match previous_input {
                    None => None,
                    Some(input_tokens) => Some(UsageSnapshot {
                        vector: NormalizedTokenUsage::new(
                            input_tokens,
                            row.get(13)?,
                            row.get(14)?,
                            row.get(15)?,
                            row.get(16)?,
                            row.get(17)?,
                        )
                        .map_err(super::to_domain_sql_error)?,
                        fingerprint: row.get(18)?,
                    }),
                };
                Ok(UsageSourceStateWrite {
                    file_generation: row.get(0)?,
                    device_id: row.get(1)?,
                    inode: row.get(2)?,
                    usage_parser_version: row.get(3)?,
                    canonical_algorithm_version: row.get(4)?,
                    resolved_through_offset: row.get(5)?,
                    observed_raw_size: row.get(6)?,
                    raw_tail_status: UsageTailStatus::parse(&tail)
                        .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?,
                    raw_tail_start_offset: row.get(8)?,
                    owning_thread_id: row.get(9)?,
                    root_session_id: row.get(10)?,
                    continuation_state: UsageContinuationState::parse(&continuation)
                        .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?,
                    previous_total,
                    previous_total_offset: row.get(19)?,
                    chain_state: match (chain.as_str(), reason.as_deref()) {
                        ("continuous", None) => UsageChainState::Continuous,
                        ("interrupted", Some(reason)) => UsageChainState::Interrupted(
                            UsageGapReason::parse(reason)
                                .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?,
                        ),
                        _ => return Err(rusqlite::Error::InvalidParameterName(
                            "invalid usage chain state".to_owned(),
                        )),
                    },
                    active_turn_key: row.get(22)?,
                    active_model: row.get(23)?,
                    active_model_offset: row.get(24)?,
                    active_reasoning_effort: row.get(25)?,
                    active_reasoning_effort_offset: row.get(26)?,
                    updated_at_ms: row.get(27)?,
                })
            },
        )
        .optional()
        .map_err(StorageError::from)
}
'''
s = s[:start] + read_fn + s[end:]

# Replace write_source_state_row so continuation is bound rather than hard-coded.
start = s.index('fn write_source_state_row(')
end = s.index('\nfn write_usage_checkpoint(', start)
write_fn = r'''fn write_source_state_row(
    transaction: &Transaction<'_>,
    ledger_epoch: i64,
    source_file_id: i64,
    state: &UsageSourceStateWrite,
) -> StorageResult<()> {
    let previous = snapshot_columns(state.previous_total.as_ref());
    let (chain, reason) = match state.chain_state {
        UsageChainState::Continuous => ("continuous", None),
        UsageChainState::Interrupted(reason) => ("interrupted", Some(reason.as_str())),
    };
    transaction.execute(
        "INSERT INTO usage_source_states (
            ledger_epoch,source_file_id,file_generation,device_id,inode,usage_parser_version,
            canonical_algorithm_version,resolved_through_offset,observed_raw_size,raw_tail_status,
            raw_tail_start_offset,owning_thread_id,root_session_id,continuation_state,
            previous_total_input_tokens,previous_total_cached_tokens,
            previous_total_cache_write_tokens,previous_total_output_tokens,
            previous_total_reasoning_tokens,previous_total_total_tokens,
            previous_total_fingerprint,previous_total_offset,chain_state,chain_block_reason,
            active_turn_key,active_model,active_model_offset,active_reasoning_effort,
            active_reasoning_effort_offset,updated_at_ms
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,
            ?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30)
         ON CONFLICT(ledger_epoch,source_file_id) DO UPDATE SET
            file_generation=excluded.file_generation,device_id=excluded.device_id,inode=excluded.inode,
            usage_parser_version=excluded.usage_parser_version,
            canonical_algorithm_version=excluded.canonical_algorithm_version,
            resolved_through_offset=excluded.resolved_through_offset,
            observed_raw_size=excluded.observed_raw_size,raw_tail_status=excluded.raw_tail_status,
            raw_tail_start_offset=excluded.raw_tail_start_offset,
            owning_thread_id=excluded.owning_thread_id,root_session_id=excluded.root_session_id,
            continuation_state=excluded.continuation_state,
            previous_total_input_tokens=excluded.previous_total_input_tokens,
            previous_total_cached_tokens=excluded.previous_total_cached_tokens,
            previous_total_cache_write_tokens=excluded.previous_total_cache_write_tokens,
            previous_total_output_tokens=excluded.previous_total_output_tokens,
            previous_total_reasoning_tokens=excluded.previous_total_reasoning_tokens,
            previous_total_total_tokens=excluded.previous_total_total_tokens,
            previous_total_fingerprint=excluded.previous_total_fingerprint,
            previous_total_offset=excluded.previous_total_offset,chain_state=excluded.chain_state,
            chain_block_reason=excluded.chain_block_reason,active_turn_key=excluded.active_turn_key,
            active_model=excluded.active_model,active_model_offset=excluded.active_model_offset,
            active_reasoning_effort=excluded.active_reasoning_effort,
            active_reasoning_effort_offset=excluded.active_reasoning_effort_offset,
            updated_at_ms=excluded.updated_at_ms",
        params![
            ledger_epoch,source_file_id,state.file_generation,state.device_id,state.inode,
            state.usage_parser_version,state.canonical_algorithm_version,state.resolved_through_offset,
            state.observed_raw_size,state.raw_tail_status.as_str(),state.raw_tail_start_offset,
            state.owning_thread_id,state.root_session_id,state.continuation_state.as_str(),
            previous.0,previous.1,previous.2,previous.3,previous.4,previous.5,previous.6,
            state.previous_total_offset,chain,reason,state.active_turn_key,state.active_model,
            state.active_model_offset,state.active_reasoning_effort,state.active_reasoning_effort_offset,
            state.updated_at_ms
        ],
    )?;
    Ok(())
}
'''
s = s[:start] + write_fn + s[end:]
save(p, s)

# Facade mapping between storage and pipeline continuation states.
p = 'src/usage/ledger.rs'
s = load(p)
s = once(
    s,
    '''        CheckpointExpectation, CheckpointStatus, PipelineDisposition, PipelineError, PlanAction,
        SourceStateProof, TailStatus, UsagePipeline, UsagePipelinePlan, UsageSourceCommitDto,''',
    '''        CheckpointExpectation, CheckpointStatus, PipelineDisposition, PipelineError, PlanAction,
        SourceContinuationState, SourceStateProof, TailStatus, UsagePipeline, UsagePipelinePlan,
        UsageSourceCommitDto,''',
    'ledger continuation import',
)
s = once(
    s,
    '''        owning_thread_id: value.owning_thread_id.clone(),
        root_session_id: value.root_session_id.clone(),
        processor_state: UsageSourceState {''',
    '''        owning_thread_id: value.owning_thread_id.clone(),
        root_session_id: value.root_session_id.clone(),
        continuation_state: match value.continuation_state {
            storage::usage::UsageContinuationState::ReplayedAncestor => {
                SourceContinuationState::ReplayedAncestor
            }
            storage::usage::UsageContinuationState::OwningLive => SourceContinuationState::OwningLive,
        },
        processor_state: UsageSourceState {''',
    'ledger storage to pipeline continuation',
)
s = once(
    s,
    '''        owning_thread_id: value.owning_thread_id.clone(),
        root_session_id: value.root_session_id.clone(),
        previous_total: value.processor_state.previous_total.as_ref().map(snapshot),''',
    '''        owning_thread_id: value.owning_thread_id.clone(),
        root_session_id: value.root_session_id.clone(),
        continuation_state: match value.continuation_state {
            SourceContinuationState::ReplayedAncestor => {
                storage::usage::UsageContinuationState::ReplayedAncestor
            }
            SourceContinuationState::OwningLive => storage::usage::UsageContinuationState::OwningLive,
        },
        previous_total: value.processor_state.previous_total.as_ref().map(snapshot),''',
    'ledger pipeline to storage continuation',
)
# Every pipeline plan defaults false; scanner may elevate it from the metadata safe fact.
s = once(
    s,
    '''        checkpoint,
        state: source.state.clone(),
        replayed_prefix_bytes_before_chunk,''',
    '''        checkpoint,
        state: source.state.clone(),
        allow_replay_tail: false,
        replayed_prefix_bytes_before_chunk,''',
    'ledger pipeline plan replay flag',
)
# Test source proof(s): insert field for all exact root/session fixture shape occurrences.
s = s.replace(
    '''            owning_thread_id: "root".to_owned(),
            root_session_id: "root".to_owned(),
            processor_state:''',
    '''            owning_thread_id: "root".to_owned(),
            root_session_id: "root".to_owned(),
            continuation_state: SourceContinuationState::OwningLive,
            processor_state:''',
)
save(p, s)

# Scanner drives metadata classifier resume from the durable usage phase, and
# only extends an initial ownership batch through replay when metadata proves it.
p = 'src/scanner/usage_consumer.rs'
s = load(p)
s = once(
    s,
    '''        ActivationOutcome, ClassifiedOversizedUsageLine, ClassifiedUsageItem, ClassifiedUsageLine,
        CompletionStatus, EventKind, FixedViewTail, PipelineDisposition, PlanAction, TailStatus,
        UsageLedger, UsageScanState, UsageSourceCommitDto, UsageSourceScanPlan,''',
    '''        ActivationOutcome, ClassifiedOversizedUsageLine, ClassifiedUsageItem, ClassifiedUsageLine,
        CompletionStatus, EventKind, FixedViewTail, PipelineDisposition, PlanAction,
        SourceContinuationState, TailStatus, UsageLedger, UsageScanState, UsageSourceCommitDto,
        UsageSourceScanPlan,''',
    'scanner continuation import',
)
old = '''    let (resume_state, existing_fact) = if initial_start == 0 {
        (ResumeState::AwaitOwningMeta, None)
    } else {
        let Some(owning_thread_id) = source.owning_thread_id.clone() else {
            return Ok(UsageReadStep::NeedsRebuild);
        };
        let SafeFactState::Matching(fact) = &metadata_entry.safe_fact else {
            return Ok(UsageReadStep::NeedsRebuild);
        };
        let fact =
            RolloutThreadFact::from_safe_fact(fact).map_err(|_| "USAGE_SAFE_FACT_INVALID")?;
        (ResumeState::OwningLive { owning_thread_id }, Some(fact))
    };'''
new = '''    let (resume_state, existing_fact) = if initial_start == 0 {
        (ResumeState::AwaitOwningMeta, None)
    } else {
        let Some(owning_thread_id) = source.owning_thread_id.clone() else {
            return Ok(UsageReadStep::NeedsRebuild);
        };
        let Some(usage_state) = source.state.as_ref() else {
            return Ok(UsageReadStep::NeedsRebuild);
        };
        let SafeFactState::Matching(fact) = &metadata_entry.safe_fact else {
            return Ok(UsageReadStep::NeedsRebuild);
        };
        let fact = RolloutThreadFact::from_safe_fact(fact)
            .map_err(|_| "USAGE_SAFE_FACT_INVALID")?;
        let resume = match usage_state.continuation_state {
            SourceContinuationState::ReplayedAncestor => ResumeState::ReplayedAncestor {
                owning_thread_id,
            },
            SourceContinuationState::OwningLive => ResumeState::OwningLive { owning_thread_id },
        };
        (resume, Some(fact))
    };'''
s = once(s, old, new, 'scanner usage resume state')
# Compute replay permission from either current usage continuation or metadata final continuation.
anchor = '''    let establishing = initial_start == 0 && source.state.is_none();
    // Metadata has already parsed this exact fixed view.'''
insert = '''    let establishing = initial_start == 0 && source.state.is_none();
    let metadata_replay_tail = matches!(
        &metadata_entry.safe_fact,
        SafeFactState::Matching(fact)
            if fact.continuation_state == crate::domain::ContinuationState::ReplayedAncestor
    );
    let allow_replay_tail = metadata_replay_tail
        || source.state.as_ref().is_some_and(|state| {
            state.continuation_state == SourceContinuationState::ReplayedAncestor
        });
    // Metadata has already parsed this exact fixed view.'''
s = once(s, anchor, insert, 'scanner replay permission')
# Late replay after a known boundary is valid only with the durable replay proof.
old = '''                } else if classification.ownership != RecordOwnership::Owning {
                    // Any late foreign record after a durable/nonzero OwningLive
                    // boundary invalidates the whole source result.
                    retained.push(item);
                    return ReadControl::StopAfter;
                }

                let candidate = matches!('''
new = '''                } else if classification.ownership != RecordOwnership::Owning {
                    match classification.ownership {
                        RecordOwnership::ReplayedAncestor if allow_replay_tail => {
                            replay_window_bytes = replay_window_bytes.saturating_add(bytes);
                            replay_window_lines = replay_window_lines.saturating_add(1);
                            retained.push(item);
                            if bytes > MAX_BATCH_BYTES
                                || replay_window_bytes >= REPLAY_WINDOW_BYTES
                                || replay_window_lines >= REPLAY_WINDOW_LINES
                            {
                                return ReadControl::StopAfter;
                            }
                            return ReadControl::Continue;
                        }
                        _ => {
                            retained.push(item);
                            return ReadControl::StopAfter;
                        }
                    }
                }

                let candidate = matches!('''
s = once(s, old, new, 'scanner late replay handling')
s = once(
    s,
    '''                    || potential_candidates >= MAX_BATCH_CANDIDATES
                    || (establishing && ownership_established)
                {''',
    '''                    || potential_candidates >= MAX_BATCH_CANDIDATES
                    || (establishing && ownership_established && !allow_replay_tail)
                {''',
    'scanner initial stop condition',
)
# Pipeline gets the safe permission proof.
s = once(
    s,
    '''        let pipeline_plan = crate::usage::ledger::pipeline_plan(
            scan,''',
    '''        let mut pipeline_plan = crate::usage::ledger::pipeline_plan(
            scan,''',
    'scanner mutable pipeline plan',
)
s = once(
    s,
    '''        )
        .map_err(|_| "USAGE_PIPELINE_PLAN_FAILED")?;
        let tail = tail_from_read(&chunk);''',
    '''        )
        .map_err(|_| "USAGE_PIPELINE_PLAN_FAILED")?;
        pipeline_plan.allow_replay_tail = allow_replay_tail;
        let tail = tail_from_read(&chunk);''',
    'scanner set replay proof',
)
save(p, s)

# Fix metadata classifier re-entry: once a nonzero replay resume has returned
# to OwningLive in the same chunk, a later foreign session_meta is no longer a
# legal continuation of the original replay state.
p = 'src/codex/rollout.rs'
s = load(p)
old = '''        self.record(
            line,
            EnvelopeKind::SessionMeta,
            RecordOwnership::ReplayedAncestor,
        );
        if let Some(fact) = self.fact.as_mut() {
            fact.ownership_boundary
                .replay_start_offset
                .get_or_insert(line.start_offset);
        }
        self.machine = MachineState::ReplayedAncestor;
        self.diagnostic(
            DiagnosticCode::ForeignSessionMeta,
            DiagnosticSeverity::Warning,
            Some(line.start_offset),
            self.owning_thread_id.clone(),
            Some("id"),
        );
        if self.resumed_nonzero
            && !matches!(self.context.resume_state, ResumeState::ReplayedAncestor { .. })
        {
            self.needs_rebuild = true;
        }'''
new = '''        let was_replayed = self.machine == MachineState::ReplayedAncestor;
        self.record(
            line,
            EnvelopeKind::SessionMeta,
            RecordOwnership::ReplayedAncestor,
        );
        if let Some(fact) = self.fact.as_mut() {
            fact.ownership_boundary
                .replay_start_offset
                .get_or_insert(line.start_offset);
        }
        self.machine = MachineState::ReplayedAncestor;
        self.diagnostic(
            DiagnosticCode::ForeignSessionMeta,
            DiagnosticSeverity::Warning,
            Some(line.start_offset),
            self.owning_thread_id.clone(),
            Some("id"),
        );
        if self.resumed_nonzero && !was_replayed {
            self.needs_rebuild = true;
        }'''
s = once(s, old, new, 'metadata replay re-entry guard')
save(p, s)

# Schema v8 widens the existing usage source continuation constraint while
# preserving every current v7 column and relationship.
p = 'src/storage/schema/0008_session_resilience.sql'
s = load(p)
append = r'''

-- Usage source checkpoints can also end safely while a confirmed fork is still
-- replaying its ancestor. Rebuild the table because SQLite cannot widen CHECK.
ALTER TABLE usage_source_states RENAME TO usage_source_states_v7;
CREATE TABLE usage_source_states (
    ledger_epoch INTEGER NOT NULL CHECK (ledger_epoch > 0),
    source_file_id INTEGER NOT NULL,
    file_generation INTEGER NOT NULL CHECK (file_generation > 0),
    device_id INTEGER NOT NULL CHECK (device_id >= 0),
    inode INTEGER NOT NULL CHECK (inode >= 0),
    usage_parser_version INTEGER NOT NULL CHECK (usage_parser_version >= 0),
    canonical_algorithm_version INTEGER NOT NULL CHECK (canonical_algorithm_version >= 0),
    resolved_through_offset INTEGER NOT NULL CHECK (resolved_through_offset >= 0),
    observed_raw_size INTEGER NOT NULL CHECK (observed_raw_size >= 0),
    raw_tail_status TEXT NOT NULL CHECK (raw_tail_status IN ('unverified','none','half_line')),
    raw_tail_start_offset INTEGER CHECK (raw_tail_start_offset >= 0),
    owning_thread_id TEXT NOT NULL,
    root_session_id TEXT NOT NULL,
    continuation_state TEXT NOT NULL CHECK (continuation_state IN ('replayed_ancestor','owning_live')),
    previous_total_input_tokens INTEGER CHECK (previous_total_input_tokens >= 0),
    previous_total_cached_tokens INTEGER CHECK (previous_total_cached_tokens >= 0),
    previous_total_cache_write_tokens INTEGER CHECK (previous_total_cache_write_tokens >= 0),
    previous_total_output_tokens INTEGER CHECK (previous_total_output_tokens >= 0),
    previous_total_reasoning_tokens INTEGER CHECK (previous_total_reasoning_tokens >= 0),
    previous_total_total_tokens INTEGER CHECK (previous_total_total_tokens >= 0),
    previous_total_fingerprint BLOB,
    previous_total_offset INTEGER CHECK (previous_total_offset >= 0),
    chain_state TEXT NOT NULL CHECK (chain_state IN ('continuous','interrupted')),
    chain_block_reason TEXT CHECK (chain_block_reason IS NULL OR chain_block_reason IN ('malformed','oversized','total_invalid','ownership_gap','parser_gap')),
    active_turn_key TEXT,
    active_model TEXT,
    active_model_offset INTEGER CHECK (active_model_offset >= 0),
    active_reasoning_effort TEXT,
    active_reasoning_effort_offset INTEGER CHECK (active_reasoning_effort_offset >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    PRIMARY KEY (ledger_epoch, source_file_id),
    FOREIGN KEY (source_file_id) REFERENCES source_files(source_file_id),
    FOREIGN KEY (owning_thread_id) REFERENCES threads(thread_id),
    FOREIGN KEY (root_session_id) REFERENCES threads(thread_id),
    CHECK (resolved_through_offset <= observed_raw_size),
    CHECK ((active_model IS NULL) = (active_model_offset IS NULL)),
    CHECK ((active_reasoning_effort IS NULL) = (active_reasoning_effort_offset IS NULL)),
    CHECK ((previous_total_input_tokens IS NULL AND previous_total_cached_tokens IS NULL
        AND previous_total_cache_write_tokens IS NULL AND previous_total_output_tokens IS NULL
        AND previous_total_reasoning_tokens IS NULL AND previous_total_total_tokens IS NULL
        AND previous_total_fingerprint IS NULL AND previous_total_offset IS NULL)
      OR (previous_total_input_tokens IS NOT NULL AND previous_total_cached_tokens IS NOT NULL
        AND previous_total_output_tokens IS NOT NULL AND previous_total_reasoning_tokens IS NOT NULL
        AND previous_total_total_tokens IS NOT NULL AND previous_total_fingerprint IS NOT NULL
        AND previous_total_offset IS NOT NULL AND previous_total_offset <= resolved_through_offset
        AND previous_total_cached_tokens <= previous_total_input_tokens
        AND previous_total_reasoning_tokens <= previous_total_output_tokens
        AND previous_total_total_tokens = previous_total_input_tokens + previous_total_output_tokens
        AND (previous_total_cache_write_tokens IS NULL OR previous_total_cached_tokens + previous_total_cache_write_tokens <= previous_total_input_tokens)))
);
INSERT INTO usage_source_states SELECT * FROM usage_source_states_v7;
DROP TABLE usage_source_states_v7;
'''
if 'usage_source_states_v7' in s:
    raise SystemExit('usage source schema replay migration already present')
s += append
save(p, s)

print('usage replay continuation patch applied')
