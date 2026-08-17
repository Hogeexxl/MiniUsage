from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 0:
        if new in text:
            return text
        raise RuntimeError(f"{label}: pattern not found")
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count == 0:
        if replacement in text:
            return text
        raise RuntimeError(f"{label}: regex not found")
    return updated


# Track P — one platform path authority.
path = "src/platform/paths.rs"
text = read(path)
anchor = '''pub fn normalize_absolute_path(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    Some(simplify_verbatim_path(lexically_normalize_strict(path)?))
}
'''
addition = anchor + '''
/// Normalize a Codex source path into MiniUsage's one internal identity form.
/// Existing paths are canonicalized when possible; otherwise a strict lexical
/// normalization is used. Windows verbatim disk/UNC prefixes are simplified in
/// both cases so adapters and discovery compare the same representation.
pub fn normalize_source_path(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let normalized = fs::canonicalize(path)
        .ok()
        .map(simplify_verbatim_path)
        .or_else(|| normalize_absolute_path(path))?;
    Some(normalized)
}

/// Compare two absolute source paths after applying the same platform rules.
pub fn same_source_path(left: &Path, right: &Path) -> bool {
    match (normalize_source_path(left), normalize_source_path(right)) {
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}
'''
text = replace_once(text, anchor, addition, "paths helpers")
# Extend existing Windows regression without depending on source existence.
old = '''        let unc = normalize_absolute_path(Path::new(r"\\\\?\\UNC\\server\\share\\Codex")).unwrap();
        assert_eq!(unc, PathBuf::from(r"\\\\server\\share\\Codex"));
    }
'''
new = '''        let unc = normalize_absolute_path(Path::new(r"\\\\?\\UNC\\server\\share\\Codex")).unwrap();
        assert_eq!(unc, PathBuf::from(r"\\\\server\\share\\Codex"));
        assert!(same_source_path(
            Path::new(r"\\\\?\\C:\\Users\\用户\\Codex"),
            Path::new(r"C:\\Users\\用户\\Codex")
        ));
    }
'''
text = replace_once(text, old, new, "paths windows test")
write(path, text)

path = "src/codex/state_index.rs"
text = read(path)
text = replace_once(
    text,
    'use super::{DiagnosticSeverity, SourceAvailability};\n',
    'use super::{DiagnosticSeverity, SourceAvailability};\nuse crate::platform::paths;\n',
    "state_index platform import",
)
text = replace_once(
    text,
    '    let result = value_string(value).and_then(|value| normalize_absolute_path(&value));\n',
    '''    let result = value_string(value).and_then(|value| {
        if value.chars().any(char::is_control) {
            return None;
        }
        paths::normalize_source_path(Path::new(value.trim()))
            .and_then(|path| path.to_str().map(ToOwned::to_owned))
    });
''',
    "state_index optional_path",
)
text = regex_once(
    text,
    r'\n/// Lexically normalize an absolute path without touching the filesystem\.\nfn normalize_absolute_path\(value: &str\) -> Option<String> \{.*?\n\}\n\n(?=#\[cfg\(test\)\])',
    '\n',
    "remove state_index private path normalizer",
)
write(path, text)

path = "src/scanner/mod.rs"
text = read(path)
text = replace_once(
    text,
    '    storage::Ledger,\n};\n',
    '    platform::paths,\n    storage::Ledger,\n};\n',
    "scanner paths import",
)
text = replace_once(
    text,
    '''        .threads
        .iter()
        .find(|thread| thread.rollout_path.as_deref() == file.path.to_str())
''',
    '''        .threads
        .iter()
        .find(|thread| {
            thread
                .rollout_path
                .as_deref()
                .is_some_and(|rollout_path| paths::same_source_path(Path::new(rollout_path), &file.path))
        })
''',
    "scanner owning path comparison",
)
text = replace_once(
    text,
    '''        let existing_fact = match (&resume_state, &entry.safe_fact) {
            (ResumeState::OwningLive { .. }, SafeFactState::Matching(fact)) => {
                RolloutThreadFact::from_safe_fact(fact).ok()
            }
            _ => None,
        };
''',
    '''        let existing_fact = match (&resume_state, &entry.safe_fact) {
            (
                ResumeState::OwningLive { .. } | ResumeState::ReplayedAncestor { .. },
                SafeFactState::Matching(fact),
            ) => RolloutThreadFact::from_safe_fact(fact).ok(),
            _ => None,
        };
''',
    "scanner replay existing fact",
)
write(path, text)

# Track R — durable replay continuation.
path = "src/codex/rollout.rs"
text = read(path)
text = replace_once(text, 'pub const METADATA_PARSER_VERSION: i64 = 3;\n', 'pub const METADATA_PARSER_VERSION: i64 = 4;\n', "metadata parser version")
text = replace_once(
    text,
    '''pub enum ResumeState {
    AwaitOwningMeta,
    OwningLive { owning_thread_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FinalContinuation {
    OwningLive { owning_thread_id: String },
    Unstable,
}
''',
    '''pub enum ResumeState {
    AwaitOwningMeta,
    ReplayedAncestor { owning_thread_id: String },
    OwningLive { owning_thread_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FinalContinuation {
    ReplayedAncestor { owning_thread_id: String },
    OwningLive { owning_thread_id: String },
    Unstable,
}
''',
    "rollout continuation enums",
)
text = replace_once(
    text,
    '''            FinalContinuation::OwningLive { owning_thread_id }
                if owning_thread_id == &self.owning_thread_id =>
            {
                DomainContinuationState::OwningLive
            }
            FinalContinuation::OwningLive { .. } => {
                return Err(crate::domain::DomainError::InvariantViolation {
                    invariant: "continuation owning thread must match rollout fact",
                });
            }
            FinalContinuation::Unstable => DomainContinuationState::Unstable,
        };
        let ownership_confidence = if continuation_state == DomainContinuationState::OwningLive {
            DomainOwnershipConfidence::Confirmed
        } else {
            DomainOwnershipConfidence::Unresolved
        };
''',
    '''            FinalContinuation::ReplayedAncestor { owning_thread_id }
                if owning_thread_id == &self.owning_thread_id =>
            {
                DomainContinuationState::ReplayedAncestor
            }
            FinalContinuation::OwningLive { owning_thread_id }
                if owning_thread_id == &self.owning_thread_id =>
            {
                DomainContinuationState::OwningLive
            }
            FinalContinuation::ReplayedAncestor { .. } | FinalContinuation::OwningLive { .. } => {
                return Err(crate::domain::DomainError::InvariantViolation {
                    invariant: "continuation owning thread must match rollout fact",
                });
            }
            FinalContinuation::Unstable => DomainContinuationState::Unstable,
        };
        let ownership_confidence = if matches!(
            continuation_state,
            DomainContinuationState::ReplayedAncestor | DomainContinuationState::OwningLive
        ) {
            DomainOwnershipConfidence::Confirmed
        } else {
            DomainOwnershipConfidence::Unresolved
        };
''',
    "safe fact continuation mapping",
)
# Replace non-zero resume initialization while preserving candidate/fact validation.
old = '''        if self.context.chunk_start_offset > 0 {
            self.resumed_nonzero = true;
            let ResumeState::OwningLive { owning_thread_id } = &self.context.resume_state else {
                self.needs_rebuild = true;
                self.diagnostic(
                    DiagnosticCode::InvalidResumeState,
                    DiagnosticSeverity::Conflict,
                    None,
                    external.as_ref().map(|(thread_id, _)| thread_id.clone()),
                    Some("resume_state"),
                );
                return;
            };
            let Some(resume_id) = valid_uuid_string(Some(owning_thread_id)) else {
'''
new = '''        if self.context.chunk_start_offset > 0 {
            self.resumed_nonzero = true;
            let (owning_thread_id, resume_machine) = match &self.context.resume_state {
                ResumeState::ReplayedAncestor { owning_thread_id } => {
                    (owning_thread_id, MachineState::ReplayedAncestor)
                }
                ResumeState::OwningLive { owning_thread_id } => {
                    (owning_thread_id, MachineState::OwningLive)
                }
                ResumeState::AwaitOwningMeta => {
                    self.needs_rebuild = true;
                    self.diagnostic(
                        DiagnosticCode::InvalidResumeState,
                        DiagnosticSeverity::Conflict,
                        None,
                        external.as_ref().map(|(thread_id, _)| thread_id.clone()),
                        Some("resume_state"),
                    );
                    return;
                }
            };
            let Some(resume_id) = valid_uuid_string(Some(owning_thread_id)) else {
'''
text = replace_once(text, old, new, "rollout nonzero resume start")
text = replace_once(
    text,
    '''            self.owning_thread_id = Some(resume_id);
            self.owning_confirmed = true;
            self.machine = MachineState::OwningLive;
            return;
''',
    '''            self.owning_thread_id = Some(resume_id);
            self.owning_confirmed = true;
            self.machine = resume_machine;
            return;
''',
    "rollout nonzero resume machine",
)
# Stable EOF may remain in ancestor replay.
text = regex_once(
    text,
    r'''    fn finish\(mut self\) -> RolloutParseResult \{\n        if self\.machine == MachineState::ReplayedAncestor \{.*?\n        \}\n\n        let final_continuation = if self\.needs_rebuild \|\| !self\.owning_confirmed \{\n            FinalContinuation::Unstable\n        \} else \{\n            match \(&self\.owning_thread_id, self\.machine\) \{\n                \(\n                    Some\(owning_thread_id\),\n                    MachineState::OwningBootstrap \| MachineState::OwningLive,\n                \) => FinalContinuation::OwningLive \{\n                    owning_thread_id: owning_thread_id\.clone\(\),\n                \},\n                _ => FinalContinuation::Unstable,\n            \}\n        \};\n        if let Some\(fact\) = self\.fact\.as_mut\(\) \{\n            fact\.ownership_boundary\.confidence =\n                if matches!\(final_continuation, FinalContinuation::OwningLive \{ \.\. \} \) \{\n                    OwnershipConfidence::Confirmed\n                \} else \{\n                    OwnershipConfidence::Unresolved\n                \};\n        \}''',
    '''    fn finish(mut self) -> RolloutParseResult {
        let final_continuation = if self.needs_rebuild || !self.owning_confirmed {
            FinalContinuation::Unstable
        } else {
            match (&self.owning_thread_id, self.machine) {
                (Some(owning_thread_id), MachineState::ReplayedAncestor) => {
                    FinalContinuation::ReplayedAncestor {
                        owning_thread_id: owning_thread_id.clone(),
                    }
                }
                (
                    Some(owning_thread_id),
                    MachineState::OwningBootstrap | MachineState::OwningLive,
                ) => FinalContinuation::OwningLive {
                    owning_thread_id: owning_thread_id.clone(),
                },
                _ => FinalContinuation::Unstable,
            }
        };
        if let Some(fact) = self.fact.as_mut() {
            fact.ownership_boundary.confidence = if matches!(
                final_continuation,
                FinalContinuation::ReplayedAncestor { .. } | FinalContinuation::OwningLive { .. }
            ) {
                OwnershipConfidence::Confirmed
            } else {
                OwnershipConfidence::Unresolved
            };
        }''',
    "rollout finish continuation",
)
# Seeing the owning session_meta again is a direct replay -> owning boundary.
old = '''        if self.owning_thread_id.as_deref() == Some(session_id.as_str()) {
            self.record(line, EnvelopeKind::SessionMeta, RecordOwnership::Owning);
            if let Some(fact) = self.fact.as_mut() {
                if fact
                    .ownership_boundary
                    .owning_records_start_offset
                    .is_none()
                    && fact.ownership_boundary.replay_start_offset.is_none()
                {
                    fact.ownership_boundary.owning_records_start_offset = Some(line.start_offset);
                }
'''
new = '''        if self.owning_thread_id.as_deref() == Some(session_id.as_str()) {
            let resumed_from_replay = self.machine == MachineState::ReplayedAncestor;
            self.record(line, EnvelopeKind::SessionMeta, RecordOwnership::Owning);
            if resumed_from_replay {
                self.machine = MachineState::OwningLive;
            }
            if let Some(fact) = self.fact.as_mut() {
                if resumed_from_replay {
                    fact.ownership_boundary.owning_records_start_offset = Some(line.start_offset);
                } else if fact
                    .ownership_boundary
                    .owning_records_start_offset
                    .is_none()
                    && fact.ownership_boundary.replay_start_offset.is_none()
                {
                    fact.ownership_boundary.owning_records_start_offset = Some(line.start_offset);
                }
'''
text = replace_once(text, old, new, "rollout owning session_meta recovery")
text = replace_once(
    text,
    '''        self.machine = MachineState::ReplayedAncestor;
        self.diagnostic(
            DiagnosticCode::ForeignSessionMeta,
            DiagnosticSeverity::Warning,
            Some(line.start_offset),
            self.owning_thread_id.clone(),
            Some("id"),
        );
        if self.resumed_nonzero {
            self.needs_rebuild = true;
        }
''',
    '''        self.machine = MachineState::ReplayedAncestor;
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
        }
''',
    "rollout resumed replay foreign meta",
)
write(path, text)

path = "src/domain.rs"
text = read(path)
text = replace_once(
    text,
    '''/// Safe fact continuation state.  Only `OwningLive` can be resumed from a
/// non-zero metadata offset.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ContinuationState {
    OwningLive,
    Unstable,
}

impl ContinuationState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OwningLive => "owning_live",
            Self::Unstable => "unstable",
        }
    }
}

impl_string_enum!(ContinuationState, "continuation_state", OwningLive => "owning_live", Unstable => "unstable");
''',
    '''/// Safe fact continuation state. Confirmed owning identity may be resumed
/// either while still replaying an ancestor or after returning to owning data.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ContinuationState {
    ReplayedAncestor,
    OwningLive,
    Unstable,
}

impl ContinuationState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReplayedAncestor => "replayed_ancestor",
            Self::OwningLive => "owning_live",
            Self::Unstable => "unstable",
        }
    }
}

impl_string_enum!(
    ContinuationState,
    "continuation_state",
    ReplayedAncestor => "replayed_ancestor",
    OwningLive => "owning_live",
    Unstable => "unstable"
);
''',
    "domain continuation state",
)
text = replace_once(
    text,
    '''        if self.continuation_state == ContinuationState::OwningLive
            && self.ownership_confidence != OwnershipConfidence::Confirmed
        {
            return Err(DomainError::InvariantViolation {
                invariant: "owning_live fact must have confirmed ownership",
            });
        }
''',
    '''        if matches!(
            self.continuation_state,
            ContinuationState::ReplayedAncestor | ContinuationState::OwningLive
        ) && self.ownership_confidence != OwnershipConfidence::Confirmed
        {
            return Err(DomainError::InvariantViolation {
                invariant: "resumable fact must have confirmed ownership",
            });
        }
''',
    "domain resumable ownership validation",
)
write(path, text)

path = "src/scanner/pipeline.rs"
text = read(path)
text = replace_once(
    text,
    '''        !self.needs_rebuild
            && matches!(
                self.final_continuation,
                FinalContinuation::OwningLive { .. }
            )
            && self.fact.is_some()
''',
    '''        !self.needs_rebuild
            && matches!(
                self.final_continuation,
                FinalContinuation::ReplayedAncestor { .. } | FinalContinuation::OwningLive { .. }
            )
            && self.fact.is_some()
''',
    "pipeline parsed stable",
)
old = '''        let stable_fact = matching_stable_fact(entry);
        let resume_state = stable_fact.and_then(|fact| {
            entry
                .source
                .thread_id
                .as_ref()
                .filter(|thread_id| *thread_id == &fact.owning_thread_id)
                .map(|thread_id| ResumeState::OwningLive {
                    owning_thread_id: thread_id.clone(),
                })
        });
'''
new = '''        let stable_fact = matching_stable_fact(entry);
        let resume_state = stable_fact.and_then(|fact| {
            let thread_id = entry
                .source
                .thread_id
                .as_ref()
                .filter(|thread_id| *thread_id == &fact.owning_thread_id)?;
            match fact.continuation_state {
                crate::domain::ContinuationState::ReplayedAncestor => {
                    Some(ResumeState::ReplayedAncestor {
                        owning_thread_id: thread_id.clone(),
                    })
                }
                crate::domain::ContinuationState::OwningLive => Some(ResumeState::OwningLive {
                    owning_thread_id: thread_id.clone(),
                }),
                crate::domain::ContinuationState::Unstable => None,
            }
        });
'''
text = replace_once(text, old, new, "pipeline resume state")
text = replace_once(
    text,
    '''    if fact.continuation_state != crate::domain::ContinuationState::OwningLive {
        return None;
    }
''',
    '''    if !matches!(
        fact.continuation_state,
        crate::domain::ContinuationState::ReplayedAncestor
            | crate::domain::ContinuationState::OwningLive
    ) {
        return None;
    }
''',
    "pipeline stable fact continuation",
)
write(path, text)

# Schema 8 — durable replay state plus quarantine primitives used by Track Q.
migration = r'''-- MiniUsage schema version 8: resilient metadata continuation and Session quarantine.
-- The migration runner executes this script inside one BEGIN IMMEDIATE transaction.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE rollout_metadata_facts_v8 (
    source_file_id INTEGER PRIMARY KEY,
    file_generation INTEGER NOT NULL CHECK (file_generation > 0),
    metadata_parser_version INTEGER NOT NULL CHECK (metadata_parser_version >= 0),
    resolved_through_offset INTEGER NOT NULL CHECK (resolved_through_offset >= 0),
    owning_thread_id TEXT NOT NULL,
    continuation_state TEXT NOT NULL CHECK (
        continuation_state IN ('replayed_ancestor', 'owning_live', 'unstable')
    ),
    cwd TEXT,
    cwd_provenance TEXT CHECK (cwd_provenance IS NULL OR cwd_provenance IN ('session_meta', 'turn_context')),
    cwd_record_offset INTEGER CHECK (cwd_record_offset IS NULL OR cwd_record_offset >= 0),
    created_at_ms INTEGER,
    latest_context_model TEXT,
    latest_context_at_ms INTEGER,
    parent_thread_id_hint TEXT,
    parent_hint_provenance TEXT CHECK (parent_hint_provenance IS NULL OR parent_hint_provenance IN ('session_meta_parent','subagent_source','forked_from_id')),
    parent_hint_record_offset INTEGER CHECK (parent_hint_record_offset IS NULL OR parent_hint_record_offset >= 0),
    agent_role_hint TEXT,
    agent_role_provenance TEXT CHECK (agent_role_provenance IS NULL OR agent_role_provenance IN ('session_meta_role','subagent_source')),
    agent_role_record_offset INTEGER CHECK (agent_role_record_offset IS NULL OR agent_role_record_offset >= 0),
    agent_path TEXT,
    agent_path_provenance TEXT CHECK (agent_path_provenance IS NULL OR agent_path_provenance IN ('session_meta','thread_spawn')),
    agent_path_record_offset INTEGER CHECK (agent_path_record_offset IS NULL OR agent_path_record_offset >= 0),
    replay_start_offset INTEGER CHECK (replay_start_offset IS NULL OR replay_start_offset >= 0),
    owning_records_start_offset INTEGER CHECK (owning_records_start_offset IS NULL OR owning_records_start_offset >= 0),
    ownership_confidence TEXT NOT NULL CHECK (ownership_confidence IN ('confirmed', 'unresolved')),
    fact_quality_status TEXT NOT NULL CHECK (fact_quality_status IN ('complete', 'partial', 'conflict')),
    updated_at_ms INTEGER NOT NULL,
    CHECK ((cwd IS NULL AND cwd_provenance IS NULL AND cwd_record_offset IS NULL) OR (cwd IS NOT NULL AND cwd_provenance IS NOT NULL AND cwd_record_offset IS NOT NULL)),
    CHECK ((parent_thread_id_hint IS NULL AND parent_hint_provenance IS NULL AND parent_hint_record_offset IS NULL) OR (parent_thread_id_hint IS NOT NULL AND parent_hint_provenance IS NOT NULL AND parent_hint_record_offset IS NOT NULL)),
    CHECK ((agent_role_hint IS NULL AND agent_role_provenance IS NULL AND agent_role_record_offset IS NULL) OR (agent_role_hint IS NOT NULL AND agent_role_provenance IS NOT NULL AND agent_role_record_offset IS NOT NULL)),
    CHECK ((agent_path IS NULL AND agent_path_provenance IS NULL AND agent_path_record_offset IS NULL) OR (agent_path IS NOT NULL AND agent_path_provenance IS NOT NULL AND agent_path_record_offset IS NOT NULL)),
    CHECK (continuation_state NOT IN ('replayed_ancestor','owning_live') OR ownership_confidence = 'confirmed'),
    CHECK (created_at_ms IS NULL OR created_at_ms >= 0),
    CHECK (latest_context_at_ms IS NULL OR latest_context_at_ms >= 0),
    CHECK (updated_at_ms >= 0),
    FOREIGN KEY (source_file_id) REFERENCES source_files(source_file_id) ON DELETE CASCADE
);
INSERT INTO rollout_metadata_facts_v8 (
    source_file_id,file_generation,metadata_parser_version,resolved_through_offset,owning_thread_id,continuation_state,
    cwd,cwd_provenance,cwd_record_offset,created_at_ms,latest_context_model,latest_context_at_ms,
    parent_thread_id_hint,parent_hint_provenance,parent_hint_record_offset,agent_role_hint,agent_role_provenance,
    agent_role_record_offset,agent_path,agent_path_provenance,agent_path_record_offset,replay_start_offset,
    owning_records_start_offset,ownership_confidence,fact_quality_status,updated_at_ms
)
SELECT source_file_id,file_generation,metadata_parser_version,resolved_through_offset,owning_thread_id,continuation_state,
    cwd,cwd_provenance,cwd_record_offset,created_at_ms,latest_context_model,latest_context_at_ms,
    parent_thread_id_hint,parent_hint_provenance,parent_hint_record_offset,agent_role_hint,agent_role_provenance,
    agent_role_record_offset,agent_path,agent_path_provenance,agent_path_record_offset,replay_start_offset,
    owning_records_start_offset,ownership_confidence,fact_quality_status,updated_at_ms
FROM rollout_metadata_facts;
DROP TABLE rollout_metadata_facts;
ALTER TABLE rollout_metadata_facts_v8 RENAME TO rollout_metadata_facts;
CREATE INDEX rollout_metadata_facts_thread_idx ON rollout_metadata_facts(owning_thread_id);

CREATE TABLE usage_build_sources_v8 (
    build_epoch INTEGER NOT NULL CHECK (build_epoch > 0),
    source_file_id INTEGER NOT NULL,
    target_parser_version INTEGER NOT NULL CHECK (target_parser_version >= 0),
    expected_file_generation INTEGER NOT NULL CHECK (expected_file_generation > 0),
    expected_device_id INTEGER NOT NULL CHECK (expected_device_id >= 0),
    expected_inode INTEGER NOT NULL CHECK (expected_inode >= 0),
    expected_owning_thread_id TEXT,
    expected_root_session_id TEXT,
    active_committed_offset INTEGER NOT NULL CHECK (active_committed_offset >= 0),
    active_guard_hash BLOB,
    active_state_fingerprint BLOB,
    required_generation INTEGER NOT NULL CHECK (required_generation > 0),
    required_through_offset INTEGER NOT NULL CHECK (required_through_offset >= 0),
    observed_raw_size INTEGER NOT NULL CHECK (observed_raw_size >= 0),
    raw_tail_status TEXT NOT NULL CHECK (raw_tail_status IN ('unverified','none','half_line')),
    raw_tail_start_offset INTEGER CHECK (raw_tail_start_offset >= 0),
    membership_reason TEXT NOT NULL CHECK (membership_reason IN ('active_contributor','present_at_build_start','both','discovered_during_build')),
    completion_status TEXT NOT NULL CHECK (completion_status IN ('pending','rebuilt','carried','blocked','quarantined')),
    completion_error_code TEXT,
    completed_generation INTEGER CHECK (completed_generation > 0),
    completed_through_offset INTEGER CHECK (completed_through_offset >= 0),
    carry_from_epoch INTEGER CHECK (carry_from_epoch >= 0),
    carry_phase TEXT NOT NULL CHECK (carry_phase IN ('none','occurrences','turns','anomalies','finalize')),
    carry_after_start_offset INTEGER CHECK (carry_after_start_offset >= 0),
    carry_after_turn_key TEXT,
    carry_after_anomaly_id TEXT,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    PRIMARY KEY (build_epoch, source_file_id),
    FOREIGN KEY (source_file_id) REFERENCES source_files(source_file_id),
    CHECK (required_generation = expected_file_generation),
    CHECK (required_through_offset <= observed_raw_size),
    CHECK ((raw_tail_status='unverified' AND raw_tail_start_offset IS NULL) OR (raw_tail_status='none' AND raw_tail_start_offset IS NULL AND required_through_offset=observed_raw_size) OR (raw_tail_status='half_line' AND raw_tail_start_offset=required_through_offset AND required_through_offset<observed_raw_size)),
    CHECK ((completion_status IN ('pending','blocked','quarantined') AND completed_generation IS NULL AND completed_through_offset IS NULL) OR (completion_status IN ('rebuilt','carried') AND completed_generation=required_generation AND completed_through_offset IS NOT NULL AND completed_through_offset>=required_through_offset)),
    CHECK ((completion_status IN ('blocked','quarantined')) = (completion_error_code IS NOT NULL)),
    CHECK (completion_status <> 'quarantined' OR expected_root_session_id IS NOT NULL),
    CHECK ((carry_phase='none' AND carry_from_epoch IS NULL AND carry_after_start_offset IS NULL AND carry_after_turn_key IS NULL AND carry_after_anomaly_id IS NULL) OR (carry_phase<>'none' AND carry_from_epoch IS NOT NULL))
);
INSERT INTO usage_build_sources_v8 SELECT * FROM usage_build_sources;
DROP TABLE usage_build_sources;
ALTER TABLE usage_build_sources_v8 RENAME TO usage_build_sources;
CREATE INDEX usage_build_sources_status_idx ON usage_build_sources(build_epoch, completion_status);

CREATE TABLE usage_session_quarantine (
    ledger_epoch INTEGER NOT NULL CHECK (ledger_epoch > 0),
    root_session_id TEXT NOT NULL CHECK (length(root_session_id) > 0),
    primary_error_code TEXT NOT NULL CHECK (length(primary_error_code) > 0),
    first_seen_at_ms INTEGER NOT NULL CHECK (first_seen_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    PRIMARY KEY (ledger_epoch, root_session_id),
    FOREIGN KEY (root_session_id) REFERENCES threads(thread_id)
);
CREATE INDEX usage_session_quarantine_epoch_idx ON usage_session_quarantine(ledger_epoch);
'''
write("src/storage/schema/0008_session_resilience.sql", migration)

path = "src/storage/migrations.rs"
text = read(path)
text = replace_once(text, 'pub const LATEST_SCHEMA_VERSION: u32 = 7;\n', 'pub const LATEST_SCHEMA_VERSION: u32 = 8;\n', "schema version")
text = replace_once(
    text,
    '''    Migration {
        version: 7,
        sql: include_str!("schema/0007_usage_context_and_estimated_cost.sql"),
    },
];
''',
    '''    Migration {
        version: 7,
        sql: include_str!("schema/0007_usage_context_and_estimated_cost.sql"),
    },
    Migration {
        version: 8,
        sql: include_str!("schema/0008_session_resilience.sql"),
    },
];
''',
    "register migration 8",
)
write(path, text)

print("Applied Track P + Track R + schema 8 patch")
