from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def replace_once(rel: str, old: str, new: str) -> None:
    text = read(rel)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{rel}: expected one match, found {count}: {old[:120]!r}")
    write(rel, text.replace(old, new, 1))


def replace_all(rel: str, old: str, new: str, expected: int | None = None) -> None:
    text = read(rel)
    count = text.count(old)
    if expected is not None and count != expected:
        raise RuntimeError(f"{rel}: expected {expected} matches, found {count}: {old[:120]!r}")
    if count == 0:
        raise RuntimeError(f"{rel}: no match: {old[:120]!r}")
    write(rel, text.replace(old, new))


# ---------------------------------------------------------------------------
# Track A: rolling 7d / 30d ranges and local civil-day buckets
# ---------------------------------------------------------------------------
replace_once(
    "src/range.rs",
    """pub enum RangeKey {
    Today,
    Yesterday,
    Week,
    Month,
    Year,
}""",
    """pub enum RangeKey {
    Today,
    Yesterday,
    SevenDays,
    ThirtyDays,
    Year,
}""",
)
replace_once(
    "src/range.rs",
    """            Some(\"week\") => Ok(Self::Week),
            Some(\"month\") => Ok(Self::Month),""",
    """            Some(\"7d\") => Ok(Self::SevenDays),
            Some(\"30d\") => Ok(Self::ThirtyDays),""",
)
replace_once(
    "src/range.rs",
    """            Self::Week => \"week\",
            Self::Month => \"month\",""",
    """            Self::SevenDays => \"7d\",
            Self::ThirtyDays => \"30d\",""",
)
replace_once(
    "src/range.rs",
    """        RangeKey::Week => {
            let start = today
                .checked_sub_days(Days::new(u64::from(today.weekday().num_days_from_monday())))
                .ok_or(ApiError::LocalTimeUnavailable)?;
            let end = start
                .checked_add_days(Days::new(7))
                .ok_or(ApiError::LocalTimeUnavailable)?;
            Ok((start, end))
        }
        RangeKey::Month => {
            let start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                .ok_or(ApiError::LocalTimeUnavailable)?;
            let (year, month) = if today.month() == 12 {
                (today.year().checked_add(1), 1)
            } else {
                (Some(today.year()), today.month() + 1)
            };
            let end =
                NaiveDate::from_ymd_opt(year.ok_or(ApiError::LocalTimeUnavailable)?, month, 1)
                    .ok_or(ApiError::LocalTimeUnavailable)?;
            Ok((start, end))
        }""",
    """        RangeKey::SevenDays => Ok((
            today
                .checked_sub_days(Days::new(6))
                .ok_or(ApiError::LocalTimeUnavailable)?,
            next_day(today)?,
        )),
        RangeKey::ThirtyDays => Ok((
            today
                .checked_sub_days(Days::new(29))
                .ok_or(ApiError::LocalTimeUnavailable)?,
            next_day(today)?,
        )),""",
)
# Datelike::weekday/month are no longer needed; year remains.
replace_once("src/range.rs", "use chrono::{DateTime, Datelike, Days, NaiveDate};", "use chrono::{DateTime, Datelike, Days, NaiveDate};")

replace_once(
    "src/range.rs",
    """impl ResolvedRange {
    pub(crate) fn aggregate_range(&self) -> Result<TimeRange, ApiError> {
        TimeRange::new(self.start_ms, self.end_ms).map_err(|_| ApiError::InvalidRange)
    }
}
""",
    """impl ResolvedRange {
    pub(crate) fn aggregate_range(&self) -> Result<TimeRange, ApiError> {
        TimeRange::new(self.start_ms, self.end_ms).map_err(|_| ApiError::InvalidRange)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedDay {
    pub date: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// Resolve every local civil day covered by a named range. The returned
/// boundaries are UTC milliseconds, but the day labels and midnight edges are
/// determined exclusively by the range's IANA time zone. SQLite and the
/// frontend never need platform-local time conversion.
pub fn resolve_day_buckets(range: &ResolvedRange) -> Result<Vec<ResolvedDay>, ApiError> {
    #[cfg(windows)]
    {
        return resolve_day_buckets_with_loader(range, EmbeddedZone::load);
    }
    #[cfg(not(windows))]
    {
        resolve_day_buckets_with_loader(range, TzifZone::load)
    }
}

fn resolve_day_buckets_with_loader<L, Z>(range: &ResolvedRange, loader: L) -> Result<Vec<ResolvedDay>, ApiError>
where
    L: FnOnce(&str) -> Result<Z, ApiError>,
    Z: CivilZone,
{
    let zone = loader(&range.timezone)?;
    let start_seconds = range.start_ms.div_euclid(1_000);
    let local_seconds = start_seconds
        .checked_add(i64::from(zone.offset_at(start_seconds)?))
        .ok_or(ApiError::LocalTimeUnavailable)?;
    let mut date = DateTime::from_timestamp(local_seconds, 0)
        .ok_or(ApiError::LocalTimeUnavailable)?
        .date_naive();
    let mut days = Vec::new();
    while days.len() < 400 {
        let start_ms = zone.local_midnight_to_utc_ms(date)?;
        if start_ms >= range.end_ms {
            break;
        }
        let next = date
            .checked_add_days(Days::new(1))
            .ok_or(ApiError::LocalTimeUnavailable)?;
        let end_ms = zone.local_midnight_to_utc_ms(next)?;
        if start_ms < range.start_ms || end_ms > range.end_ms || end_ms <= start_ms {
            return Err(ApiError::LocalTimeUnavailable);
        }
        days.push(ResolvedDay {
            date: date.format(\"%Y-%m-%d\").to_string(),
            start_ms,
            end_ms,
        });
        date = next;
    }
    if days.is_empty() || days.last().is_none_or(|day| day.end_ms != range.end_ms) {
        return Err(ApiError::LocalTimeUnavailable);
    }
    Ok(days)
}
""",
)

# Update the frozen UTC range unit matrix.
range_text = read("src/range.rs")
range_text = range_text.replace("RangeKey::Week", "RangeKey::SevenDays").replace("RangeKey::Month", "RangeKey::ThirtyDays")
range_text = range_text.replace("(\"2026-08-03T00:00:00Z\", \"2026-08-10T00:00:00Z\")", "(\"2026-08-02T00:00:00Z\", \"2026-08-09T00:00:00Z\")")
range_text = range_text.replace("(\"2026-08-01T00:00:00Z\", \"2026-09-01T00:00:00Z\")", "(\"2026-07-10T00:00:00Z\", \"2026-08-09T00:00:00Z\")")
write("src/range.rs", range_text)

# ---------------------------------------------------------------------------
# Track B: schema v9 and privacy-safe Skill usage parser
# ---------------------------------------------------------------------------
write(
    "src/storage/schema/0009_skill_usage_events.sql",
    """CREATE TABLE skill_usage_events (
    ledger_epoch INTEGER NOT NULL CHECK (ledger_epoch > 0),
    source_file_id INTEGER NOT NULL,
    file_generation INTEGER NOT NULL CHECK (file_generation > 0),
    source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
    source_end_offset INTEGER NOT NULL CHECK (source_end_offset > source_start_offset),
    occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
    thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
    root_session_id TEXT NOT NULL CHECK (length(root_session_id) > 0),
    model TEXT,
    skill_name TEXT NOT NULL CHECK (length(skill_name) > 0 AND length(skill_name) <= 128),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    PRIMARY KEY (ledger_epoch, source_file_id, file_generation, source_start_offset, skill_name),
    FOREIGN KEY (source_file_id) REFERENCES source_files(source_file_id) ON DELETE CASCADE
);

CREATE INDEX idx_skill_usage_epoch_time
    ON skill_usage_events(ledger_epoch, occurred_at_ms);
CREATE INDEX idx_skill_usage_epoch_root_time
    ON skill_usage_events(ledger_epoch, root_session_id, occurred_at_ms);
CREATE INDEX idx_skill_usage_epoch_model_time
    ON skill_usage_events(ledger_epoch, model, occurred_at_ms);
CREATE INDEX idx_skill_usage_epoch_source_start
    ON skill_usage_events(ledger_epoch, source_file_id, source_start_offset);
""",
)
replace_once("src/storage/migrations.rs", "pub const LATEST_SCHEMA_VERSION: u32 = 8;", "pub const LATEST_SCHEMA_VERSION: u32 = 9;")
replace_once(
    "src/storage/migrations.rs",
    """    Migration {
        version: 8,
        sql: include_str!(\"schema/0008_session_resilience.sql\"),
    },
];""",
    """    Migration {
        version: 8,
        sql: include_str!(\"schema/0008_session_resilience.sql\"),
    },
    Migration {
        version: 9,
        sql: include_str!(\"schema/0009_skill_usage_events.sql\"),
    },
];""",
)
replace_once(
    "src/storage/mod.rs",
    '    "usage_build_sources",\n];',
    '    "usage_build_sources",\n    "skill_usage_events",\n];',
)

write(
    "src/codex/skill_usage.rs",
    r'''//! Privacy-safe Skill invocation extraction from complete Codex rollout lines.
//!
//! Raw tool payloads are inspected transiently and are never retained. Skill
//! locators are parsed as strings so Windows and Unix forms produce identical
//! results without touching the filesystem or depending on permissions.

use std::collections::BTreeSet;

use chrono::DateTime;
use serde_json::Value;

use super::CompleteUsageLine;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillUsageEvidence {
    pub occurred_at_ms: i64,
    pub skill_names: Vec<String>,
}

pub struct SkillUsageParser;

impl SkillUsageParser {
    pub fn parse_line(&self, line: &CompleteUsageLine) -> Option<SkillUsageEvidence> {
        if !line.json_bytes().windows(b"SKILL.md".len()).any(|window| window == b"SKILL.md") {
            return None;
        }
        let value: Value = serde_json::from_slice(line.json_bytes()).ok()?;
        let object = value.as_object()?;
        if object.get("type").and_then(Value::as_str) != Some("response_item") {
            return None;
        }
        let payload = object.get("payload")?.as_object()?;
        let item_type = payload.get("type")?.as_str()?;
        if !item_type.ends_with("_call") {
            return None;
        }
        let occurred_at_ms = payload
            .get("timestamp")
            .and_then(parse_timestamp_ms)
            .or_else(|| object.get("timestamp").and_then(parse_timestamp_ms))?;
        let mut names = BTreeSet::new();
        collect_skill_names(&Value::Object(payload.clone()), &mut names);
        (!names.is_empty()).then(|| SkillUsageEvidence {
            occurred_at_ms,
            skill_names: names.into_iter().collect(),
        })
    }
}

fn collect_skill_names(value: &Value, output: &mut BTreeSet<String>) {
    match value {
        Value::String(text) => extract_from_text(text, output),
        Value::Array(values) => {
            for value in values {
                collect_skill_names(value, output);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                collect_skill_names(value, output);
            }
        }
        _ => {}
    }
}

fn extract_from_text(text: &str, output: &mut BTreeSet<String>) {
    let normalized = text.replace('\\', "/");
    let mut cursor = 0usize;
    while let Some(relative) = normalized[cursor..].find("SKILL.md") {
        let index = cursor + relative;
        let before = normalized[..index].trim_end_matches('/');
        if let Some(name) = before.rsplit('/').next().filter(|value| valid_skill_name(value)) {
            output.insert(name.to_owned());
        }
        cursor = index.saturating_add("SKILL.md".len());
        if cursor >= normalized.len() {
            break;
        }
    }
}

fn valid_skill_name(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.len() <= 128
        && !value.chars().any(char::is_control)
        && !value.chars().any(|character| matches!(character, '/' | '\\'))
}

fn parse_timestamp_ms(value: &Value) -> Option<i64> {
    value.as_i64().filter(|value| *value >= 0).or_else(|| {
        value
            .as_str()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.timestamp_millis())
            .filter(|value| *value >= 0)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(json: &str) -> CompleteUsageLine {
        CompleteUsageLine::new(0, format!("{json}\n").into_bytes()).unwrap()
    }

    #[test]
    fn t_013_003_skill_locator_is_cross_platform_and_deduplicated_per_call() {
        let parser = SkillUsageParser;
        let parsed = parser
            .parse_line(&line(
                r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"custom_tool_call","input":"cat /Users/me/.codex/skills/frontend-skill/SKILL.md && type C:\\Users\\me\\.codex\\skills\\diagnosing-bugs\\SKILL.md && cat /Users/me/.codex/skills/frontend-skill/SKILL.md"}}"#,
            ))
            .unwrap();
        assert_eq!(parsed.skill_names, vec!["diagnosing-bugs", "frontend-skill"]);
    }

    #[test]
    fn t_013_003_skill_listing_message_and_missing_timestamp_are_not_usage() {
        let parser = SkillUsageParser;
        assert!(parser
            .parse_line(&line(
                r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"message","content":"<skills_instructions>/x/foo/SKILL.md</skills_instructions>"}}"#,
            ))
            .is_none());
        assert!(parser
            .parse_line(&line(
                r#"{"type":"response_item","payload":{"type":"custom_tool_call","input":"cat /x/foo/SKILL.md"}}"#,
            ))
            .is_none());
    }
}
''',
)
replace_once("src/codex/mod.rs", "mod global_state;\nmod metadata;", "mod global_state;\nmod metadata;\nmod skill_usage;")
replace_once(
    "src/codex/mod.rs",
    "pub use usage::{",
    "pub use skill_usage::{SkillUsageEvidence, SkillUsageParser};\npub use usage::{",
)
replace_once("src/codex/usage.rs", "    fn json_bytes(&self) -> &[u8] {", "    pub(crate) fn json_bytes(&self) -> &[u8] {")

write(
    "src/usage/skills.rs",
    '''#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillUsageEvent {
    pub occurred_at_ms: i64,
    pub thread_id: String,
    pub root_session_id: String,
    pub model: Option<String>,
    pub skill_name: String,
    pub source_file_id: i64,
    pub file_generation: i64,
    pub source_start_offset: u64,
    pub source_end_offset: u64,
}
''',
)
replace_once("src/usage/mod.rs", "pub mod rebuild;", "pub mod rebuild;\npub mod skills;")
replace_once(
    "src/usage/mod.rs",
    "pub use normalized::{",
    "pub use skills::SkillUsageEvent;\npub use normalized::{",
)
replace_once("src/usage/normalized.rs", "pub const USAGE_PARSER_VERSION: i64 = 7;", "pub const USAGE_PARSER_VERSION: i64 = 8;")
replace_once(
    "src/usage/normalized.rs",
    "        6 | USAGE_PARSER_VERSION => Some(USAGE_CANONICAL_ALGORITHM_VERSION),",
    "        6 | 7 | USAGE_PARSER_VERSION => Some(USAGE_CANONICAL_ALGORITHM_VERSION),",
)

# Pipeline: collect Skill events from the exact same fixed-view line stream.
replace_once(
    "src/usage/pipeline.rs",
    """    CodexRolloutParser, CompleteUsageLine, EnvelopeKind, LifecycleKind, NormalizedTokenValue,
    OptionalTokenValue, RecordClassification, RecordOwnership, UsageRawRecord,""",
    """    CodexRolloutParser, CompleteUsageLine, EnvelopeKind, LifecycleKind, NormalizedTokenValue,
    OptionalTokenValue, RecordClassification, RecordOwnership, SkillUsageParser, UsageRawRecord,""",
)
replace_once(
    "src/usage/pipeline.rs",
    """use super::processor::{
    Anomaly, ClosedTurn, GapKind, Occurrence, Ownership, ProcessResult, TurnEndStatus, TurnState,
    UsageContext, UsageEvent, UsageProcessor, UsageRecord, UsageSourceState, UsageValue,
};""",
    """use super::{
    processor::{
        Anomaly, ClosedTurn, GapKind, Occurrence, Ownership, ProcessResult, TurnEndStatus, TurnState,
        UsageContext, UsageEvent, UsageProcessor, UsageRecord, UsageSourceState, UsageValue,
    },
    skills::SkillUsageEvent,
};""",
)
replace_once(
    "src/usage/pipeline.rs",
    """    pub events: Vec<UsageEvent>,
    pub occurrences: Vec<Occurrence>,
    pub closed_turns: Vec<ClosedTurn>,""",
    """    pub events: Vec<UsageEvent>,
    pub occurrences: Vec<Occurrence>,
    pub skill_events: Vec<SkillUsageEvent>,
    pub closed_turns: Vec<ClosedTurn>,""",
)
replace_all(
    "src/usage/pipeline.rs",
    """        let mut events = Vec::new();
        let mut occurrences = Vec::new();""",
    """        let mut events = Vec::new();
        let mut occurrences = Vec::new();
        let mut skill_events = Vec::new();""",
    expected=1,
)
replace_all(
    "src/usage/pipeline.rs",
    """    let mut events = Vec::new();
    let mut occurrences = Vec::new();""",
    """    let mut events = Vec::new();
    let mut occurrences = Vec::new();
    let mut skill_events = Vec::new();""",
    expected=2,
)
# Insert extraction before the three raw usage parsing points.
replace_once(
    "src/usage/pipeline.rs",
    """            let record = match &item {
                ClassifiedUsageItem::Line(value) => adapter.parse_line(&value.line),""",
    """            collect_skill_events(&item, &state, &context, &mut skill_events);
            let record = match &item {
                ClassifiedUsageItem::Line(value) => adapter.parse_line(&value.line),""",
)
replace_all(
    "src/usage/pipeline.rs",
    """        let raw = match &item {
            ClassifiedUsageItem::Line(value) => adapter.parse_line(&value.line),""",
    """        collect_skill_events(&item, &state, &context, &mut skill_events);
        let raw = match &item {
            ClassifiedUsageItem::Line(value) => adapter.parse_line(&value.line),""",
    expected=2,
)
# Every commit_dto call passes the accumulated Skill rows immediately after ProcessResult.
pipeline = read("src/usage/pipeline.rs")
# The argument sequence is unique at each call: result then last / or ProcessResult literal then last.
pipeline = pipeline.replace("""            result,
            last_complete_offset,""", """            result,
            skill_events,
            last_complete_offset,""")
pipeline = pipeline.replace("""                },
                last,""", """                },
                skill_events,
                last,""")
pipeline = pipeline.replace("""        result,
        last,""", """        result,
        skill_events,
        last,""")
if pipeline.count("skill_events,") < 4:
    raise RuntimeError("pipeline: not all commit_dto calls received skill_events")
write("src/usage/pipeline.rs", pipeline)
replace_once(
    "src/usage/pipeline.rs",
    """    result: ProcessResult,
    last_complete_offset: u64,""",
    """    result: ProcessResult,
    skill_events: Vec<SkillUsageEvent>,
    last_complete_offset: u64,""",
)
replace_once(
    "src/usage/pipeline.rs",
    """        events: result.events,
        occurrences: result.occurrences,
        closed_turns: result.closed_turns,""",
    """        events: result.events,
        occurrences: result.occurrences,
        skill_events,
        closed_turns: result.closed_turns,""",
)
# Add helper before matching_item.
replace_once(
    "src/usage/pipeline.rs",
    """fn matching_item(item: &ClassifiedUsageItem, expected: u64, observed_size: u64) -> bool {""",
    """fn collect_skill_events(
    item: &ClassifiedUsageItem,
    state: &UsageSourceState,
    context: &UsageContext,
    output: &mut Vec<SkillUsageEvent>,
) {
    if item.classification().ownership != RecordOwnership::Owning {
        return;
    }
    let ClassifiedUsageItem::Line(value) = item else {
        return;
    };
    let Some(evidence) = SkillUsageParser.parse_line(&value.line) else {
        return;
    };
    for skill_name in evidence.skill_names {
        output.push(SkillUsageEvent {
            occurred_at_ms: evidence.occurred_at_ms,
            thread_id: context.owning_thread_id.clone(),
            root_session_id: context.root_session_id.clone(),
            model: state.active_model.clone(),
            skill_name,
            source_file_id: context.source_file_id,
            file_generation: context.file_generation,
            source_start_offset: value.line.start_offset(),
            source_end_offset: value.line.end_offset(),
        });
    }
}

fn matching_item(item: &ClassifiedUsageItem, expected: u64, observed_size: u64) -> bool {""",
)

# Ledger maps pipeline Skill facts into storage writes.
replace_once(
    "src/usage/ledger.rs",
    """    let occurrences = dto
        .occurrences
        .iter()
        .map(|occurrence| {
            Ok(storage::usage::UsageOccurrenceWrite {
                source_file_id: occurrence.source_file_id,
                file_generation: occurrence.file_generation,
                source_start_offset: u64_to_i64(occurrence.source_start_offset)?,
                source_end_offset: u64_to_i64(occurrence.source_end_offset)?,
                event_id: occurrence.event_id.clone(),
            })
        })
        .collect::<Result<Vec<_>, UsageLedgerError>>()?;
    let anomalies = dto""",
    """    let occurrences = dto
        .occurrences
        .iter()
        .map(|occurrence| {
            Ok(storage::usage::UsageOccurrenceWrite {
                source_file_id: occurrence.source_file_id,
                file_generation: occurrence.file_generation,
                source_start_offset: u64_to_i64(occurrence.source_start_offset)?,
                source_end_offset: u64_to_i64(occurrence.source_end_offset)?,
                event_id: occurrence.event_id.clone(),
            })
        })
        .collect::<Result<Vec<_>, UsageLedgerError>>()?;
    let skill_events = dto
        .skill_events
        .iter()
        .map(|event| {
            Ok(storage::usage::SkillUsageEventWrite {
                occurred_at_ms: event.occurred_at_ms,
                thread_id: event.thread_id.clone(),
                root_session_id: event.root_session_id.clone(),
                model: event.model.clone(),
                skill_name: event.skill_name.clone(),
                source_file_id: event.source_file_id,
                file_generation: event.file_generation,
                source_start_offset: u64_to_i64(event.source_start_offset)?,
                source_end_offset: u64_to_i64(event.source_end_offset)?,
            })
        })
        .collect::<Result<Vec<_>, UsageLedgerError>>()?;
    let anomalies = dto""",
)
replace_once(
    "src/usage/ledger.rs",
    """        events,
        occurrences,
        turns,
        anomalies,""",
    """        events,
        occurrences,
        skill_events,
        turns,
        anomalies,""",
)

# Atomic storage seam. These are intentionally targeted replacements in the
# existing storage module so token/rebuild semantics remain unchanged.
replace_once(
    "src/storage/usage.rs",
    """pub(crate) struct UsageOccurrenceWrite {
    pub source_file_id: i64,
    pub file_generation: i64,
    pub source_start_offset: i64,
    pub source_end_offset: i64,
    pub event_id: String,
}
""",
    """pub(crate) struct UsageOccurrenceWrite {
    pub source_file_id: i64,
    pub file_generation: i64,
    pub source_start_offset: i64,
    pub source_end_offset: i64,
    pub event_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SkillUsageEventWrite {
    pub occurred_at_ms: i64,
    pub thread_id: String,
    pub root_session_id: String,
    pub model: Option<String>,
    pub skill_name: String,
    pub source_file_id: i64,
    pub file_generation: i64,
    pub source_start_offset: i64,
    pub source_end_offset: i64,
}
""",
)
replace_once(
    "src/storage/usage.rs",
    """    pub events: Vec<UsageEventWrite>,
    pub occurrences: Vec<UsageOccurrenceWrite>,
    pub turns: Vec<UsageTurnWrite>,""",
    """    pub events: Vec<UsageEventWrite>,
    pub occurrences: Vec<UsageOccurrenceWrite>,
    pub skill_events: Vec<SkillUsageEventWrite>,
    pub turns: Vec<UsageTurnWrite>,""",
)
# Add Skill visibility to revision detection.
replace_once(
    "src/storage/usage.rs",
    """        let canonical_before = capture_affected_canonical_visibility(&transaction, batch)?;
        let has_local_replay = batch.sources.iter().any(|source| source.local_replay);""",
    """        let canonical_before = capture_affected_canonical_visibility(&transaction, batch)?;
        let skills_before = capture_skill_visibility(&transaction, batch)?;
        let has_local_replay = batch.sources.iter().any(|source| source.local_replay);""",
)
replace_once(
    "src/storage/usage.rs",
    """            for turn in &source.turns {
                write_turn(""",
    """            for skill in &source.skill_events {
                write_or_compare_skill_event(
                    &transaction,
                    batch.ledger_epoch,
                    source,
                    skill,
                )?;
            }
            for turn in &source.turns {
                write_turn(""",
)
replace_once(
    "src/storage/usage.rs",
    """        let canonical_changed = affected_canonical_visibility_changed(
            &transaction,
            batch.ledger_epoch,
            &canonical_before,
        )?;
""",
    """        let token_visibility_changed = affected_canonical_visibility_changed(
            &transaction,
            batch.ledger_epoch,
            &canonical_before,
        )?;
        let skill_visibility_changed = affected_skill_visibility_changed(
            &transaction,
            batch.ledger_epoch,
            &skills_before,
        )?;
        let canonical_changed = token_visibility_changed || skill_visibility_changed;
""",
)
# Carry scans offsets from token occurrences and Skill events, copying both.
replace_once(
    "src/storage/usage.rs",
    """    let mut statement = transaction.prepare(
        \"SELECT source_start_offset,event_id FROM usage_event_occurrences
         WHERE ledger_epoch=?1 AND source_file_id=?2
           AND (?3 IS NULL OR source_start_offset>?3)
         ORDER BY source_start_offset LIMIT ?4\",
    )?;
    let rows = statement
        .query_map(
            params![active_epoch, source_file_id, after, CARRY_PAGE_ROWS + 1],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = rows.len() > CARRY_PAGE_ROWS as usize;
    let copy = &rows[..rows.len().min(CARRY_PAGE_ROWS as usize)];
    for (start, event_id) in copy {
        carry_canonical_event(transaction, active_epoch, build_epoch, event_id)?;
        carry_occurrence(
            transaction,
            active_epoch,
            build_epoch,
            source_file_id,
            *start,
        )?;
    }
    let next_after = copy.last().map(|row| row.0).or(after);""",
    """    let mut statement = transaction.prepare(
        \"SELECT source_start_offset FROM (
             SELECT source_start_offset FROM usage_event_occurrences
              WHERE ledger_epoch=?1 AND source_file_id=?2
             UNION
             SELECT source_start_offset FROM skill_usage_events
              WHERE ledger_epoch=?1 AND source_file_id=?2
         ) WHERE (?3 IS NULL OR source_start_offset>?3)
         ORDER BY source_start_offset LIMIT ?4\",
    )?;
    let rows = statement
        .query_map(
            params![active_epoch, source_file_id, after, CARRY_PAGE_ROWS + 1],
            |row| row.get::<_, i64>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = rows.len() > CARRY_PAGE_ROWS as usize;
    let copy = &rows[..rows.len().min(CARRY_PAGE_ROWS as usize)];
    for start in copy {
        let event_id: Option<String> = transaction
            .query_row(
                \"SELECT event_id FROM usage_event_occurrences
                 WHERE ledger_epoch=?1 AND source_file_id=?2 AND source_start_offset=?3\",
                params![active_epoch, source_file_id, start],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(event_id) = event_id {
            carry_canonical_event(transaction, active_epoch, build_epoch, &event_id)?;
            carry_occurrence(
                transaction,
                active_epoch,
                build_epoch,
                source_file_id,
                *start,
            )?;
        }
        carry_skill_events_at_offset(
            transaction,
            active_epoch,
            build_epoch,
            source_file_id,
            *start,
        )?;
    }
    let next_after = copy.last().copied().or(after);""",
)
# Add skill set verification before Turn fingerprints.
replace_once(
    "src/storage/usage.rs",
    """    // Compare complete active/build rows through deterministic fingerprints in
    // Rust so that updated_at_ms and ledger_epoch are the only excluded fields.""",
    """    let skill_diff: i64 = transaction.query_row(
        \"SELECT
          (SELECT count(*) FROM (
             SELECT file_generation,source_start_offset,source_end_offset,occurred_at_ms,
                    thread_id,root_session_id,model,skill_name
             FROM skill_usage_events WHERE ledger_epoch=?1 AND source_file_id=?3
             EXCEPT
             SELECT file_generation,source_start_offset,source_end_offset,occurred_at_ms,
                    thread_id,root_session_id,model,skill_name
             FROM skill_usage_events WHERE ledger_epoch=?2 AND source_file_id=?3))
        + (SELECT count(*) FROM (
             SELECT file_generation,source_start_offset,source_end_offset,occurred_at_ms,
                    thread_id,root_session_id,model,skill_name
             FROM skill_usage_events WHERE ledger_epoch=?2 AND source_file_id=?3
             EXCEPT
             SELECT file_generation,source_start_offset,source_end_offset,occurred_at_ms,
                    thread_id,root_session_id,model,skill_name
             FROM skill_usage_events WHERE ledger_epoch=?1 AND source_file_id=?3))\",
        params![active_epoch, build_epoch, source_file_id],
        |row| row.get(0),
    )?;
    if skill_diff != 0 {
        return Err(StorageError::usage_conflict(\"usage carry Skill set mismatch\"));
    }
    // Compare complete active/build rows through deterministic fingerprints in
    // Rust so that updated_at_ms and ledger_epoch are the only excluded fields.""",
)
# Local replay safety/contribution counts include Skills.
replace_all(
    "src/storage/usage.rs",
    """          + (SELECT count(*) FROM turns WHERE ledger_epoch=?1 AND source_file_id=?2)
          + (SELECT count(*) FROM ingest_anomalies WHERE ledger_epoch=?1 AND source_file_id=?2)""",
    """          + (SELECT count(*) FROM skill_usage_events WHERE ledger_epoch=?1 AND source_file_id=?2)
          + (SELECT count(*) FROM turns WHERE ledger_epoch=?1 AND source_file_id=?2)
          + (SELECT count(*) FROM ingest_anomalies WHERE ledger_epoch=?1 AND source_file_id=?2)""",
    expected=1,
)
replace_once(
    "src/storage/usage.rs",
    """                (SELECT count(*) FROM turns WHERE ledger_epoch=?1 AND source_file_id=?2) +
                (SELECT count(*) FROM ingest_anomalies WHERE ledger_epoch=?1 AND source_file_id=?2) +""",
    """                (SELECT count(*) FROM skill_usage_events WHERE ledger_epoch=?1 AND source_file_id=?2) +
                (SELECT count(*) FROM turns WHERE ledger_epoch=?1 AND source_file_id=?2) +
                (SELECT count(*) FROM ingest_anomalies WHERE ledger_epoch=?1 AND source_file_id=?2) +""",
)
replace_once(
    "src/storage/usage.rs",
    """    transaction.execute(
        \"DELETE FROM turns WHERE ledger_epoch=?1 AND source_file_id=?2\",
        params![batch.ledger_epoch, source.source_file_id],
    )?;""",
    """    transaction.execute(
        \"DELETE FROM skill_usage_events WHERE ledger_epoch=?1 AND source_file_id=?2\",
        params![batch.ledger_epoch, source.source_file_id],
    )?;
    transaction.execute(
        \"DELETE FROM turns WHERE ledger_epoch=?1 AND source_file_id=?2\",
        params![batch.ledger_epoch, source.source_file_id],
    )?;""",
)
# Inactive cleanup.
replace_once(
    "src/storage/usage.rs",
    """            \"DELETE FROM turns WHERE rowid IN (
                SELECT rowid FROM turns WHERE ledger_epoch<>?1 AND ledger_epoch<>?2
                ORDER BY ledger_epoch,rowid LIMIT ?3)\",""",
    """            \"DELETE FROM skill_usage_events WHERE rowid IN (
                SELECT rowid FROM skill_usage_events WHERE ledger_epoch<>?1 AND ledger_epoch<>?2
                ORDER BY ledger_epoch,rowid LIMIT ?3)\",
            \"DELETE FROM turns WHERE rowid IN (
                SELECT rowid FROM turns WHERE ledger_epoch<>?1 AND ledger_epoch<>?2
                ORDER BY ledger_epoch,rowid LIMIT ?3)\",""",
)
# Root reconciliation.
replace_once(
    "src/storage/usage.rs",
    """        transaction.execute(
            \"UPDATE usage_source_states SET root_session_id=?1
             WHERE ledger_epoch=?2 AND owning_thread_id=?3\",
            params![next_root, active_epoch, thread_id],
        )?;""",
    """        transaction.execute(
            \"UPDATE skill_usage_events SET root_session_id=?1
             WHERE ledger_epoch=?2 AND thread_id=?3\",
            params![next_root, active_epoch, thread_id],
        )?;
        transaction.execute(
            \"UPDATE usage_source_states SET root_session_id=?1
             WHERE ledger_epoch=?2 AND owning_thread_id=?3\",
            params![next_root, active_epoch, thread_id],
        )?;""",
)
# Validate Skill payloads.
replace_once(
    "src/storage/usage.rs",
    """    for (event, occurrence) in source.events.iter().zip(&source.occurrences) {
        event
            .usage
            .validate()""",
    """    for skill in &source.skill_events {
        if skill.source_file_id != source.source_file_id
            || skill.file_generation != source.expected_file_generation
            || skill.thread_id != batch.thread_id
            || skill.root_session_id != batch.root_session_id
            || skill.occurred_at_ms < 0
            || skill.skill_name.is_empty()
            || skill.skill_name.len() > 128
            || skill.skill_name.chars().any(char::is_control)
            || skill.model.as_ref().is_some_and(|model| {
                model.trim().is_empty() || model.chars().any(char::is_control)
            })
            || skill.source_start_offset < source.batch_start_offset
            || skill.source_end_offset > source.last_complete_offset
            || skill.source_end_offset <= skill.source_start_offset
        {
            return Err(StorageError::invalid_state(\"invalid Skill usage event\"));
        }
    }
    for (event, occurrence) in source.events.iter().zip(&source.occurrences) {
        event
            .usage
            .validate()""",
)
# SourceCommit test helper needs the new field.
replace_once(
    "src/storage/usage.rs",
    """            occurrences: vec![UsageOccurrenceWrite {
                source_file_id: source_id,
                file_generation: 1,
                source_start_offset: 0,
                source_end_offset: 20,
                event_id,
            }],
            turns:""",
    """            occurrences: vec![UsageOccurrenceWrite {
                source_file_id: source_id,
                file_generation: 1,
                source_start_offset: 0,
                source_end_offset: 20,
                event_id,
            }],
            skill_events: Vec::new(),
            turns:""",
)
# Insert storage helpers before token occurrence writer.
replace_once(
    "src/storage/usage.rs",
    """fn write_or_compare_occurrence(
    transaction: &Transaction<'_>,""",
    r'''fn write_or_compare_skill_event(
    transaction: &Transaction<'_>,
    epoch: i64,
    source: &UsageSourceCommit,
    event: &SkillUsageEventWrite,
) -> StorageResult<()> {
    let existing: Option<(i64, i64, String, String, Option<String>)> = transaction
        .query_row(
            "SELECT source_end_offset,occurred_at_ms,thread_id,root_session_id,model
             FROM skill_usage_events
             WHERE ledger_epoch=?1 AND source_file_id=?2 AND file_generation=?3
               AND source_start_offset=?4 AND skill_name=?5",
            params![
                epoch,
                event.source_file_id,
                event.file_generation,
                event.source_start_offset,
                event.skill_name
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()?;
    let expected = (
        event.source_end_offset,
        event.occurred_at_ms,
        event.thread_id.clone(),
        event.root_session_id.clone(),
        event.model.clone(),
    );
    if let Some(existing) = existing {
        if existing == expected {
            return Ok(());
        }
        return Err(StorageError::usage_conflict("Skill usage event conflict"));
    }
    transaction.execute(
        "INSERT INTO skill_usage_events(
            ledger_epoch,source_file_id,file_generation,source_start_offset,source_end_offset,
            occurred_at_ms,thread_id,root_session_id,model,skill_name,created_at_ms)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            epoch,
            source.source_file_id,
            source.expected_file_generation,
            event.source_start_offset,
            event.source_end_offset,
            event.occurred_at_ms,
            event.thread_id,
            event.root_session_id,
            event.model,
            event.skill_name,
            source.committed_at_ms
        ],
    )?;
    Ok(())
}

fn skill_source_fingerprint(
    transaction: &Transaction<'_>,
    epoch: i64,
    source_file_id: i64,
) -> StorageResult<Vec<u8>> {
    let mut statement = transaction.prepare(
        "SELECT file_generation,source_start_offset,source_end_offset,occurred_at_ms,
                thread_id,root_session_id,model,skill_name
         FROM skill_usage_events
         WHERE ledger_epoch=?1 AND source_file_id=?2
         ORDER BY file_generation,source_start_offset,skill_name",
    )?;
    let mut rows = statement.query(params![epoch, source_file_id])?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"skill-usage-source-v1\0");
    while let Some(row) = rows.next()? {
        let values = [
            row.get::<_, i64>(0)?.to_string(),
            row.get::<_, i64>(1)?.to_string(),
            row.get::<_, i64>(2)?.to_string(),
            row.get::<_, i64>(3)?.to_string(),
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "\0".to_owned()),
            row.get::<_, String>(7)?,
        ];
        for value in values {
            hasher.update(&(value.len() as u64).to_be_bytes());
            hasher.update(value.as_bytes());
        }
    }
    Ok(hasher.finalize().as_bytes().to_vec())
}

fn capture_skill_visibility(
    transaction: &Transaction<'_>,
    batch: &UsageCommitBatch,
) -> StorageResult<Vec<(i64, Vec<u8>)>> {
    batch
        .sources
        .iter()
        .map(|source| {
            Ok((
                source.source_file_id,
                skill_source_fingerprint(transaction, batch.ledger_epoch, source.source_file_id)?,
            ))
        })
        .collect()
}

fn affected_skill_visibility_changed(
    transaction: &Transaction<'_>,
    epoch: i64,
    before: &[(i64, Vec<u8>)],
) -> StorageResult<bool> {
    for (source_file_id, fingerprint) in before {
        if &skill_source_fingerprint(transaction, epoch, *source_file_id)? != fingerprint {
            return Ok(true);
        }
    }
    Ok(false)
}

fn carry_skill_events_at_offset(
    transaction: &Transaction<'_>,
    active_epoch: i64,
    build_epoch: i64,
    source_file_id: i64,
    start_offset: i64,
) -> StorageResult<()> {
    transaction.execute(
        "INSERT INTO skill_usage_events(
            ledger_epoch,source_file_id,file_generation,source_start_offset,source_end_offset,
            occurred_at_ms,thread_id,root_session_id,model,skill_name,created_at_ms)
         SELECT ?1,source_file_id,file_generation,source_start_offset,source_end_offset,
            occurred_at_ms,thread_id,root_session_id,model,skill_name,created_at_ms
         FROM skill_usage_events a
         WHERE a.ledger_epoch=?2 AND a.source_file_id=?3 AND a.source_start_offset=?4
           AND NOT EXISTS(
             SELECT 1 FROM skill_usage_events b
             WHERE b.ledger_epoch=?1 AND b.source_file_id=a.source_file_id
               AND b.file_generation=a.file_generation
               AND b.source_start_offset=a.source_start_offset AND b.skill_name=a.skill_name)",
        params![build_epoch, active_epoch, source_file_id, start_offset],
    )?;
    let diff: i64 = transaction.query_row(
        "SELECT
          (SELECT count(*) FROM (
             SELECT file_generation,source_end_offset,occurred_at_ms,thread_id,root_session_id,model,skill_name
             FROM skill_usage_events WHERE ledger_epoch=?1 AND source_file_id=?3 AND source_start_offset=?4
             EXCEPT
             SELECT file_generation,source_end_offset,occurred_at_ms,thread_id,root_session_id,model,skill_name
             FROM skill_usage_events WHERE ledger_epoch=?2 AND source_file_id=?3 AND source_start_offset=?4))
        + (SELECT count(*) FROM (
             SELECT file_generation,source_end_offset,occurred_at_ms,thread_id,root_session_id,model,skill_name
             FROM skill_usage_events WHERE ledger_epoch=?2 AND source_file_id=?3 AND source_start_offset=?4
             EXCEPT
             SELECT file_generation,source_end_offset,occurred_at_ms,thread_id,root_session_id,model,skill_name
             FROM skill_usage_events WHERE ledger_epoch=?1 AND source_file_id=?3 AND source_start_offset=?4))",
        params![active_epoch, build_epoch, source_file_id, start_offset],
        |row| row.get(0),
    )?;
    if diff != 0 {
        return Err(StorageError::usage_conflict("usage carry Skill event conflict"));
    }
    Ok(())
}

fn write_or_compare_occurrence(
    transaction: &Transaction<'_>,''',
)

# ---------------------------------------------------------------------------
# Track C: read-only analytics snapshots
# ---------------------------------------------------------------------------
write(
    "src/usage/analytics.rs",
    r'''use rusqlite::{TransactionBehavior, params, params_from_iter, types::Value};

use crate::{
    range::ResolvedDay,
    storage::{Ledger, StorageError},
};

use super::{
    aggregate::{AggregateError, TimeRange, UsageFilter},
    ledger::UsageLedgerError,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DistributionCostStatus {
    Complete,
    Partial,
    Unknown,
}

impl DistributionCostStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Partial => "partial",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DistributionUsage {
    pub total_tokens: i64,
    pub estimated_cost_nanos_usd: Option<i64>,
    pub cost_status: DistributionCostStatus,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelDistributionRow {
    pub model: String,
    pub usage: DistributionUsage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectDistributionIdentity {
    Project { project_name: String, project_path: String },
    Projectless,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectDistributionRow {
    pub identity: ProjectDistributionIdentity,
    pub usage: DistributionUsage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillCount {
    pub skill_name: String,
    pub count: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillDayUsage {
    pub date: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub total: i64,
    pub skills: Vec<SkillCount>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillsUsage {
    pub ready: bool,
    pub days: Vec<SkillDayUsage>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnalyticsSnapshot<T> {
    pub data_revision: i64,
    pub active_epoch: i64,
    pub value: T,
}

fn snapshot_meta(transaction: &rusqlite::Transaction<'_>) -> Result<(i64, i64, i64), UsageLedgerError> {
    let values = transaction
        .query_row(
            "SELECT data_revision,usage_active_epoch,usage_parser_version FROM app_meta WHERE id=1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
        )
        .map_err(StorageError::sqlite)?;
    if values.0 < 0 || values.1 < 0 || values.2 < 0 {
        return Err(UsageLedgerError::Invalid("invalid analytics snapshot metadata"));
    }
    Ok(values)
}

fn scoped_where(
    event_alias: &str,
    root_alias: &str,
    epoch: i64,
    range: TimeRange,
    filter: &UsageFilter,
) -> (String, Vec<Value>) {
    let mut values = vec![
        Value::Integer(epoch),
        Value::Integer(range.start_ms),
        Value::Integer(range.end_ms),
    ];
    let mut clauses = vec![
        format!("{event_alias}.ledger_epoch=?1"),
        format!("{event_alias}.occurred_at_ms>=?2"),
        format!("{event_alias}.occurred_at_ms<?3"),
    ];
    if !filter.models().is_empty() {
        let mut placeholders = Vec::new();
        for model in filter.models() {
            values.push(Value::Text(model.clone()));
            placeholders.push(format!("?{}", values.len()));
        }
        clauses.push(format!("{event_alias}.model IN ({})", placeholders.join(",")));
    }
    let mut projects = Vec::new();
    if !filter.project_paths().is_empty() {
        let mut placeholders = Vec::new();
        for path in filter.project_paths() {
            values.push(Value::Text(path.clone()));
            placeholders.push(format!("?{}", values.len()));
        }
        projects.push(format!(
            "({root_alias}.project_kind='project' AND {root_alias}.project_path IN ({}))",
            placeholders.join(",")
        ));
    }
    if filter.include_projectless() {
        projects.push(format!("{root_alias}.project_kind='projectless'"));
    }
    if filter.include_unknown_project() {
        projects.push(format!("({root_alias}.project_kind='unknown' OR {root_alias}.thread_id IS NULL)"));
    }
    if !projects.is_empty() {
        clauses.push(format!("({})", projects.join(" OR ")));
    }
    (clauses.join(" AND "), values)
}

fn distribution_usage(
    total_tokens: i64,
    cost: Option<i64>,
    unknown_count: i64,
    event_count: i64,
) -> Result<DistributionUsage, UsageLedgerError> {
    if total_tokens < 0 || unknown_count < 0 || event_count <= 0 || unknown_count > event_count {
        return Err(UsageLedgerError::Aggregate(AggregateError::InvariantViolation));
    }
    let (estimated_cost_nanos_usd, cost_status) = if unknown_count == 0 {
        (Some(cost.unwrap_or(0)), DistributionCostStatus::Complete)
    } else if unknown_count < event_count {
        (cost, DistributionCostStatus::Partial)
    } else {
        (None, DistributionCostStatus::Unknown)
    };
    if estimated_cost_nanos_usd.is_some_and(|value| value < 0) {
        return Err(UsageLedgerError::Aggregate(AggregateError::InvariantViolation));
    }
    Ok(DistributionUsage { total_tokens, estimated_cost_nanos_usd, cost_status })
}

pub fn model_distribution_snapshot(
    ledger: &Ledger,
    range: TimeRange,
    filter: &UsageFilter,
) -> Result<AnalyticsSnapshot<Vec<ModelDistributionRow>>, UsageLedgerError> {
    let mut connection = ledger.connection()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Deferred)
        .map_err(StorageError::sqlite)?;
    let (data_revision, active_epoch, _) = snapshot_meta(&transaction)?;
    let (where_clause, values) = scoped_where("ue", "root", active_epoch, range, filter);
    let sql = format!(
        "SELECT ue.model,COALESCE(SUM(ue.total_tokens),0),SUM(ue.estimated_cost_nanos_usd),
                SUM(CASE WHEN ue.estimated_cost_nanos_usd IS NULL THEN 1 ELSE 0 END),COUNT(*)
         FROM usage_events ue LEFT JOIN threads root ON root.thread_id=ue.root_session_id
         WHERE {where_clause} GROUP BY ue.model ORDER BY ue.model"
    );
    let mut statement = transaction.prepare(&sql).map_err(StorageError::sqlite)?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(StorageError::sqlite)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StorageError::sqlite)?;
    let value = rows
        .into_iter()
        .map(|(model, tokens, cost, unknown, count)| {
            Ok(ModelDistributionRow { model, usage: distribution_usage(tokens, cost, unknown, count)? })
        })
        .collect::<Result<Vec<_>, UsageLedgerError>>()?;
    transaction.commit().map_err(StorageError::sqlite)?;
    Ok(AnalyticsSnapshot { data_revision, active_epoch, value })
}

pub fn project_distribution_snapshot(
    ledger: &Ledger,
    range: TimeRange,
    filter: &UsageFilter,
) -> Result<AnalyticsSnapshot<Vec<ProjectDistributionRow>>, UsageLedgerError> {
    let mut connection = ledger.connection()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Deferred)
        .map_err(StorageError::sqlite)?;
    let (data_revision, active_epoch, _) = snapshot_meta(&transaction)?;
    let (where_clause, values) = scoped_where("ue", "root", active_epoch, range, filter);
    let sql = format!(
        "WITH scoped AS (
           SELECT CASE
                    WHEN root.project_kind='project' AND root.project_name IS NOT NULL AND root.project_path IS NOT NULL THEN 'project'
                    WHEN root.project_kind='projectless' THEN 'projectless'
                    ELSE 'unknown'
                  END AS kind,
                  CASE WHEN root.project_kind='project' AND root.project_name IS NOT NULL AND root.project_path IS NOT NULL THEN root.project_name END AS project_name,
                  CASE WHEN root.project_kind='project' AND root.project_name IS NOT NULL AND root.project_path IS NOT NULL THEN root.project_path END AS project_path,
                  ue.total_tokens,ue.estimated_cost_nanos_usd
           FROM usage_events ue LEFT JOIN threads root ON root.thread_id=ue.root_session_id
           WHERE {where_clause}
         )
         SELECT kind,project_name,project_path,COALESCE(SUM(total_tokens),0),SUM(estimated_cost_nanos_usd),
                SUM(CASE WHEN estimated_cost_nanos_usd IS NULL THEN 1 ELSE 0 END),COUNT(*)
         FROM scoped GROUP BY kind,project_name,project_path ORDER BY kind,project_path"
    );
    let mut statement = transaction.prepare(&sql).map_err(StorageError::sqlite)?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(StorageError::sqlite)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StorageError::sqlite)?;
    let value = rows
        .into_iter()
        .map(|(kind, name, path, tokens, cost, unknown, count)| {
            let identity = match (kind.as_str(), name, path) {
                ("project", Some(project_name), Some(project_path)) => {
                    ProjectDistributionIdentity::Project { project_name, project_path }
                }
                ("projectless", _, _) => ProjectDistributionIdentity::Projectless,
                _ => ProjectDistributionIdentity::Unknown,
            };
            Ok(ProjectDistributionRow {
                identity,
                usage: distribution_usage(tokens, cost, unknown, count)?,
            })
        })
        .collect::<Result<Vec<_>, UsageLedgerError>>()?;
    transaction.commit().map_err(StorageError::sqlite)?;
    Ok(AnalyticsSnapshot { data_revision, active_epoch, value })
}

pub fn skills_usage_snapshot(
    ledger: &Ledger,
    days: &[ResolvedDay],
    filter: &UsageFilter,
) -> Result<AnalyticsSnapshot<SkillsUsage>, UsageLedgerError> {
    let mut connection = ledger.connection()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Deferred)
        .map_err(StorageError::sqlite)?;
    let (data_revision, active_epoch, active_parser) = snapshot_meta(&transaction)?;
    let ready = active_epoch > 0 && active_parser >= 8;
    let mut output = Vec::with_capacity(days.len());
    for day in days {
        let range = TimeRange::new(day.start_ms, day.end_ms)?;
        let (where_clause, values) = scoped_where("se", "root", active_epoch, range, filter);
        let mut skills = if ready {
            let sql = format!(
                "SELECT se.skill_name,COUNT(*) FROM skill_usage_events se
                 LEFT JOIN threads root ON root.thread_id=se.root_session_id
                 WHERE {where_clause} GROUP BY se.skill_name
                 ORDER BY COUNT(*) DESC,se.skill_name ASC"
            );
            let mut statement = transaction.prepare(&sql).map_err(StorageError::sqlite)?;
            statement
                .query_map(params_from_iter(values.iter()), |row| {
                    Ok(SkillCount { skill_name: row.get(0)?, count: row.get(1)? })
                })
                .map_err(StorageError::sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(StorageError::sqlite)?
        } else {
            Vec::new()
        };
        skills.sort_by(|left, right| right.count.cmp(&left.count).then_with(|| left.skill_name.cmp(&right.skill_name)));
        let total = skills.iter().try_fold(0_i64, |sum, row| {
            if row.count < 0 {
                return Err(UsageLedgerError::Aggregate(AggregateError::InvariantViolation));
            }
            sum.checked_add(row.count)
                .ok_or(UsageLedgerError::Aggregate(AggregateError::ArithmeticOverflow))
        })?;
        output.push(SkillDayUsage {
            date: day.date.clone(),
            start_ms: day.start_ms,
            end_ms: day.end_ms,
            total,
            skills,
        });
    }
    transaction.commit().map_err(StorageError::sqlite)?;
    Ok(AnalyticsSnapshot {
        data_revision,
        active_epoch,
        value: SkillsUsage { ready, days: output },
    })
}
''',
)
replace_once("src/usage/mod.rs", "pub mod adapters;", "pub mod adapters;\npub mod analytics;")

# API query DTOs and mapping.
replace_once(
    "src/api/query.rs",
    """        ledger::{
            SessionDetailSnapshot, SessionRowsSnapshot, SessionSnapshot, UsageLedgerError,
            UsageSnapshot,
        },""",
    """        analytics::{
            AnalyticsSnapshot, DistributionCostStatus, ModelDistributionRow,
            ProjectDistributionIdentity, ProjectDistributionRow, SkillsUsage,
        },
        ledger::{
            SessionDetailSnapshot, SessionRowsSnapshot, SessionSnapshot, UsageLedgerError,
            UsageSnapshot,
        },""",
)
replace_once(
    "src/api/query.rs",
    """pub struct ModelsResponse {
    pub range: RangeDto,
    pub data_revision: i64,
    pub items: Vec<ModelUsageDto>,
}
""",
    """pub struct ModelsResponse {
    pub range: RangeDto,
    pub data_revision: i64,
    pub items: Vec<ModelUsageDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DistributionUsageDto {
    pub total_tokens: i64,
    pub estimated_cost: Option<f64>,
    pub estimated_cost_status: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ModelDistributionItemDto {
    pub model: String,
    pub usage: DistributionUsageDto,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ModelDistributionResponse {
    pub range: RangeDto,
    pub data_revision: i64,
    pub items: Vec<ModelDistributionItemDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProjectDistributionItemDto {
    pub kind: String,
    pub project_name: Option<String>,
    pub project_path: Option<String>,
    pub usage: DistributionUsageDto,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ProjectDistributionResponse {
    pub range: RangeDto,
    pub data_revision: i64,
    pub items: Vec<ProjectDistributionItemDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SkillCountDto {
    pub skill_name: String,
    pub count: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SkillDayDto {
    pub date: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub total: i64,
    pub skills: Vec<SkillCountDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SkillsUsageResponse {
    pub range: RangeDto,
    pub data_revision: i64,
    pub data_status: String,
    pub days: Vec<SkillDayDto>,
}
""",
)
# New mapping functions before filter_options_response.
replace_once(
    "src/api/query.rs",
    """pub fn filter_options_response(
    snapshot: UsageSnapshot<FilterOptions>,""",
    r'''pub fn model_distribution_response(
    range: &ResolvedRange,
    snapshot: AnalyticsSnapshot<Vec<ModelDistributionRow>>,
) -> Result<ModelDistributionResponse, ApiError> {
    ensure_safe(snapshot.data_revision)?;
    let items = snapshot
        .value
        .into_iter()
        .map(|row| {
            Ok(ModelDistributionItemDto {
                model: row.model,
                usage: map_distribution_usage(row.usage)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(ModelDistributionResponse {
        range: RangeDto::from(range),
        data_revision: snapshot.data_revision,
        items,
    })
}

pub fn project_distribution_response(
    range: &ResolvedRange,
    snapshot: AnalyticsSnapshot<Vec<ProjectDistributionRow>>,
) -> Result<ProjectDistributionResponse, ApiError> {
    ensure_safe(snapshot.data_revision)?;
    let items = snapshot
        .value
        .into_iter()
        .map(|row| {
            let (kind, project_name, project_path) = match row.identity {
                ProjectDistributionIdentity::Project { project_name, project_path } => {
                    ("project", Some(project_name), Some(project_path))
                }
                ProjectDistributionIdentity::Projectless => ("projectless", None, None),
                ProjectDistributionIdentity::Unknown => ("unknown", None, None),
            };
            Ok(ProjectDistributionItemDto {
                kind: kind.to_owned(),
                project_name,
                project_path,
                usage: map_distribution_usage(row.usage)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(ProjectDistributionResponse {
        range: RangeDto::from(range),
        data_revision: snapshot.data_revision,
        items,
    })
}

pub fn skills_usage_response(
    range: &ResolvedRange,
    snapshot: AnalyticsSnapshot<SkillsUsage>,
) -> Result<SkillsUsageResponse, ApiError> {
    ensure_safe(snapshot.data_revision)?;
    let days = snapshot
        .value
        .days
        .into_iter()
        .map(|day| {
            ensure_safe(day.start_ms)?;
            ensure_safe(day.end_ms)?;
            ensure_safe(day.total)?;
            let skills = day
                .skills
                .into_iter()
                .map(|skill| {
                    ensure_safe(skill.count)?;
                    Ok(SkillCountDto { skill_name: skill.skill_name, count: skill.count })
                })
                .collect::<Result<Vec<_>, ApiError>>()?;
            Ok(SkillDayDto {
                date: day.date,
                start_ms: day.start_ms,
                end_ms: day.end_ms,
                total: day.total,
                skills,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(SkillsUsageResponse {
        range: RangeDto::from(range),
        data_revision: snapshot.data_revision,
        data_status: if snapshot.value.ready { "ready" } else { "rebuilding" }.to_owned(),
        days,
    })
}

fn map_distribution_usage(
    usage: crate::usage::analytics::DistributionUsage,
) -> Result<DistributionUsageDto, ApiError> {
    ensure_safe(usage.total_tokens)?;
    let estimated_cost = match usage.estimated_cost_nanos_usd {
        Some(value) if value >= 0 => Some(value as f64 / 1_000_000_000.0),
        Some(_) => return Err(ApiError::QueryFailed),
        None => None,
    };
    let valid = match usage.cost_status {
        DistributionCostStatus::Complete => estimated_cost.is_some(),
        DistributionCostStatus::Partial => estimated_cost.is_some(),
        DistributionCostStatus::Unknown => estimated_cost.is_none(),
    };
    if !valid {
        return Err(ApiError::QueryFailed);
    }
    Ok(DistributionUsageDto {
        total_tokens: usage.total_tokens,
        estimated_cost,
        estimated_cost_status: usage.cost_status.as_str().to_owned(),
    })
}

pub fn filter_options_response(
    snapshot: UsageSnapshot<FilterOptions>,''',
)
# Update duplicate range parser test literal.
text = read("src/api/query.rs").replace("range=year&range=month", "range=year&range=30d")
write("src/api/query.rs", text)

# API routes and handlers.
replace_once(
    "src/api.rs",
    """    range::{RangeKey, resolve_system_range},""",
    """    range::{RangeKey, resolve_day_buckets, resolve_system_range},""",
)
replace_once(
    "src/api.rs",
    """        .route(\"/usage/models\", get(models))
        .route(\"/usage/filter-options\", get(filter_options))""",
    """        .route(\"/usage/models\", get(models))
        .route(\"/usage/model-distribution\", get(model_distribution))
        .route(\"/usage/projects\", get(project_distribution))
        .route(\"/usage/skills\", get(skills_usage))
        .route(\"/usage/filter-options\", get(filter_options))""",
)
replace_once(
    "src/api.rs",
    """async fn filter_options(
    State(state): State<ApiState>,""",
    r'''async fn model_distribution(
    State(state): State<ApiState>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<query::ModelDistributionResponse>, ApiError> {
    let params = query::parse_summary_params(raw_query.as_deref())?;
    let range = resolve_request_range(params.range.as_deref())?;
    let aggregate_range = range.aggregate_range()?;
    let ledger = Arc::clone(&state.context.ledger);
    let snapshot = run_blocking_query(move || {
        crate::usage::analytics::model_distribution_snapshot(&ledger, aggregate_range, &params.filter)
    })
    .await?
    .map_err(query::map_usage_ledger_error)?;
    Ok(Json(query::model_distribution_response(&range, snapshot)?))
}

async fn project_distribution(
    State(state): State<ApiState>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<query::ProjectDistributionResponse>, ApiError> {
    let params = query::parse_summary_params(raw_query.as_deref())?;
    let range = resolve_request_range(params.range.as_deref())?;
    let aggregate_range = range.aggregate_range()?;
    let ledger = Arc::clone(&state.context.ledger);
    let snapshot = run_blocking_query(move || {
        crate::usage::analytics::project_distribution_snapshot(&ledger, aggregate_range, &params.filter)
    })
    .await?
    .map_err(query::map_usage_ledger_error)?;
    Ok(Json(query::project_distribution_response(&range, snapshot)?))
}

async fn skills_usage(
    State(state): State<ApiState>,
    RawQuery(raw_query): RawQuery,
) -> Result<Json<query::SkillsUsageResponse>, ApiError> {
    let params = query::parse_summary_params(raw_query.as_deref())?;
    let range = resolve_request_range(params.range.as_deref())?;
    if range.key != RangeKey::SevenDays {
        return Err(ApiError::InvalidRange);
    }
    let days = resolve_day_buckets(&range)?;
    if days.len() != 7 {
        return Err(ApiError::LocalTimeUnavailable);
    }
    let ledger = Arc::clone(&state.context.ledger);
    let snapshot = run_blocking_query(move || {
        crate::usage::analytics::skills_usage_snapshot(&ledger, &days, &params.filter)
    })
    .await?
    .map_err(query::map_usage_ledger_error)?;
    Ok(Json(query::skills_usage_response(&range, snapshot)?))
}

async fn filter_options(
    State(state): State<ApiState>,''',
)

# ---------------------------------------------------------------------------
# Frontend data contracts and scope policy
# ---------------------------------------------------------------------------
replace_once(
    "frontend/src/data/types.ts",
    'export const RANGE_KEYS = ["today", "yesterday", "week", "month", "year"] as const;',
    'export const RANGE_KEYS = ["today", "yesterday", "7d", "30d", "year"] as const;',
)
replace_once(
    "frontend/src/data/types.ts",
    """export type FilterOptionsResponse = {
  data_revision: number;
  models: string[];
  projects: ProjectFilterOption[];
};
""",
    """export type FilterOptionsResponse = {
  data_revision: number;
  models: string[];
  projects: ProjectFilterOption[];
};

export type DistributionUsageDto = {
  total_tokens: number;
  estimated_cost: number | null;
  estimated_cost_status: EstimatedCostStatus;
};

export type ModelDistributionItemDto = {
  model: string;
  usage: DistributionUsageDto;
};

export type ModelDistributionResponse = {
  range: RangeDto;
  data_revision: number;
  items: ModelDistributionItemDto[];
};

export type ProjectDistributionItemDto = {
  kind: \"project\" | \"projectless\" | \"unknown\";
  project_name: string | null;
  project_path: string | null;
  usage: DistributionUsageDto;
};

export type ProjectDistributionResponse = {
  range: RangeDto;
  data_revision: number;
  items: ProjectDistributionItemDto[];
};

export type SkillDayDto = {
  date: string;
  start_ms: number;
  end_ms: number;
  total: number;
  skills: Array<{ skill_name: string; count: number }>;
};

export type SkillsUsageResponse = {
  range: RangeDto;
  data_revision: number;
  data_status: \"ready\" | \"rebuilding\";
  days: SkillDayDto[];
};
""",
)
# RangeSelector labels.
selector = read("frontend/src/dashboard/RangeSelector.tsx")
selector = selector.replace('week: "本周"', '"7d": "7天"').replace('month: "本月"', '"30d": "30天"')
write("frontend/src/dashboard/RangeSelector.tsx", selector)

# Client imports, parsers, methods.
replace_once(
    "frontend/src/data/miniUsageClient.ts",
    """  type UpdateStatusResponse,
} from \"./types\";""",
    """  type UpdateStatusResponse,
  type ModelDistributionResponse,
  type ProjectDistributionResponse,
  type SkillsUsageResponse,
  type DistributionUsageDto,
} from \"./types\";""",
)
replace_once(
    "frontend/src/data/miniUsageClient.ts",
    '["today", "yesterday", "week", "month", "year"]',
    '["today", "yesterday", "7d", "30d", "year"]',
)
replace_once(
    "frontend/src/data/miniUsageClient.ts",
    """function parseRevision(value: unknown): RevisionResponse {""",
    r'''function parseDistributionUsage(value: unknown): DistributionUsageDto {
  const record = requiredRecord(value);
  const estimatedCost = nullableCost(record, "estimated_cost");
  const estimatedCostStatus = requiredEstimatedCostStatus(record, "estimated_cost_status");
  if ((estimatedCost === null) !== (estimatedCostStatus === "unknown")) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    total_tokens: requiredSafeInteger(record, "total_tokens"),
    estimated_cost: estimatedCost,
    estimated_cost_status: estimatedCostStatus,
  };
}

function parseModelDistribution(value: unknown): ModelDistributionResponse {
  const record = requiredRecord(value);
  if (!Array.isArray(record.items)) throw new MiniUsageClientError("HTTP_ERROR", 200);
  return {
    range: parseRange(record.range),
    data_revision: requiredSafeInteger(record, "data_revision"),
    items: record.items.map((value) => {
      const item = requiredRecord(value);
      return { model: requiredString(item, "model"), usage: parseDistributionUsage(item.usage) };
    }),
  };
}

function parseProjectDistribution(value: unknown): ProjectDistributionResponse {
  const record = requiredRecord(value);
  if (!Array.isArray(record.items)) throw new MiniUsageClientError("HTTP_ERROR", 200);
  return {
    range: parseRange(record.range),
    data_revision: requiredSafeInteger(record, "data_revision"),
    items: record.items.map((value) => {
      const item = requiredRecord(value);
      const kind = requiredString(item, "kind");
      if (kind !== "project" && kind !== "projectless" && kind !== "unknown") {
        throw new MiniUsageClientError("HTTP_ERROR", 200);
      }
      const projectName = nullableString(item, "project_name");
      const projectPath = nullableString(item, "project_path");
      if ((kind === "project") !== (projectName !== null && projectPath !== null)) {
        throw new MiniUsageClientError("HTTP_ERROR", 200);
      }
      return {
        kind,
        project_name: projectName,
        project_path: projectPath,
        usage: parseDistributionUsage(item.usage),
      };
    }),
  };
}

function parseSkillsUsage(value: unknown): SkillsUsageResponse {
  const record = requiredRecord(value);
  const status = requiredString(record, "data_status");
  if (status !== "ready" && status !== "rebuilding") throw new MiniUsageClientError("HTTP_ERROR", 200);
  if (!Array.isArray(record.days) || record.days.length !== 7) throw new MiniUsageClientError("HTTP_ERROR", 200);
  return {
    range: parseRange(record.range),
    data_revision: requiredSafeInteger(record, "data_revision"),
    data_status: status,
    days: record.days.map((value) => {
      const day = requiredRecord(value);
      if (!Array.isArray(day.skills)) throw new MiniUsageClientError("HTTP_ERROR", 200);
      const skills = day.skills.map((value) => {
        const skill = requiredRecord(value);
        return { skill_name: requiredString(skill, "skill_name"), count: requiredSafeInteger(skill, "count") };
      });
      const total = requiredSafeInteger(day, "total");
      if (skills.reduce((sum, skill) => sum + skill.count, 0) !== total) {
        throw new MiniUsageClientError("HTTP_ERROR", 200);
      }
      return {
        date: requiredString(day, "date"),
        start_ms: requiredSafeInteger(day, "start_ms"),
        end_ms: requiredSafeInteger(day, "end_ms"),
        total,
        skills,
      };
    }),
  };
}

function parseRevision(value: unknown): RevisionResponse {''',
)
replace_once(
    "frontend/src/data/miniUsageClient.ts",
    """  summary(range: RangeKey, filters: DashboardFilters, signal?: AbortSignal): Promise<SummaryResponse>;
  getSessionSnapshot(request: {""",
    """  summary(range: RangeKey, filters: DashboardFilters, signal?: AbortSignal): Promise<SummaryResponse>;
  modelDistribution(range: RangeKey, filters: DashboardFilters, signal?: AbortSignal): Promise<ModelDistributionResponse>;
  projectDistribution(range: RangeKey, filters: DashboardFilters, signal?: AbortSignal): Promise<ProjectDistributionResponse>;
  skillsUsage(range: RangeKey, filters: DashboardFilters, signal?: AbortSignal): Promise<SkillsUsageResponse>;
  getSessionSnapshot(request: {""",
)
# Refactor common params and add methods after summary.
replace_once(
    "frontend/src/data/miniUsageClient.ts",
    """  async summary(range, filters, signal) {
    const canonical = canonicalDashboardFilters(filters);
    const params = new URLSearchParams();
    params.append(\"range\", range);
    for (const model of canonical.models) params.append(\"model\", model);
    for (const project of canonical.projects) {
      if (project.kind === \"project\") params.append(\"project_path\", project.project_path);
      if (project.kind === \"projectless\") params.append(\"include_projectless\", \"1\");
      if (project.kind === \"unknown\") params.append(\"include_unknown_project\", \"1\");
    }
    const body = await getJson<unknown>(`/api/usage/summary?${params.toString()}`, signal);
    return parseSummary(body);
  },""",
    """  async summary(range, filters, signal) {
    const params = sessionParams(range, filters);
    const body = await getJson<unknown>(`/api/usage/summary?${params.toString()}`, signal);
    return parseSummary(body);
  },
  async modelDistribution(range, filters, signal) {
    const params = sessionParams(range, filters);
    const body = await getJson<unknown>(`/api/usage/model-distribution?${params.toString()}`, signal);
    const response = parseModelDistribution(body);
    if (response.range.key !== range) throw new MiniUsageClientError(\"HTTP_ERROR\", 200);
    return response;
  },
  async projectDistribution(range, filters, signal) {
    const params = sessionParams(range, filters);
    const body = await getJson<unknown>(`/api/usage/projects?${params.toString()}`, signal);
    const response = parseProjectDistribution(body);
    if (response.range.key !== range) throw new MiniUsageClientError(\"HTTP_ERROR\", 200);
    return response;
  },
  async skillsUsage(range, filters, signal) {
    const params = sessionParams(range, filters);
    const body = await getJson<unknown>(`/api/usage/skills?${params.toString()}`, signal);
    const response = parseSkillsUsage(body);
    if (response.range.key !== range) throw new MiniUsageClientError(\"HTTP_ERROR\", 200);
    return response;
  },""",
)

write(
    "frontend/src/dashboard/scope.ts",
    '''import { canonicalDashboardFilters } from "../data/miniUsageClient";
import type { DashboardFilters, RangeKey } from "../data/types";

export type RangePolicy = { kind: "dashboard" } | { kind: "fixed"; range: RangeKey };
export type FilterPolicy = "dashboard" | "ignore";
export type DashboardScopePolicy = {
  range: RangePolicy;
  models: FilterPolicy;
  projects: FilterPolicy;
};
export type ResolvedDashboardScope = { range: RangeKey; filters: DashboardFilters };

const FOLLOW_DASHBOARD: DashboardScopePolicy = {
  range: { kind: "dashboard" },
  models: "dashboard",
  projects: "dashboard",
};
const ROLLING_7D_FILTERED: DashboardScopePolicy = {
  range: { kind: "fixed", range: "7d" },
  models: "dashboard",
  projects: "dashboard",
};

export const DASHBOARD_SCOPE_POLICIES = {
  kpi: FOLLOW_DASHBOARD,
  modelDistribution: FOLLOW_DASHBOARD,
  projectDistribution: FOLLOW_DASHBOARD,
  sessions: FOLLOW_DASHBOARD,
  skillsUsage: ROLLING_7D_FILTERED,
} as const;

export function resolveDashboardScope(
  policy: DashboardScopePolicy,
  dashboardRange: RangeKey,
  dashboardFilters: DashboardFilters,
): ResolvedDashboardScope {
  const canonical = canonicalDashboardFilters(dashboardFilters);
  return {
    range: policy.range.kind === "dashboard" ? dashboardRange : policy.range.range,
    filters: {
      models: policy.models === "dashboard" ? canonical.models : [],
      projects: policy.projects === "dashboard" ? canonical.projects : [],
    },
  };
}
''',
)
write(
    "frontend/src/dashboard/scope.test.ts",
    '''import { describe, expect, it } from "vitest";
import { DASHBOARD_SCOPE_POLICIES, resolveDashboardScope } from "./scope";

const filters = {
  models: ["b", "a", "a"],
  projects: [{ kind: "project" as const, project_path: "/repo" }],
};

describe("Dashboard scope policy", () => {
  it("keeps Dashboard scope for KPI/distributions/sessions and fixes Skills to rolling 7d", () => {
    for (const key of ["kpi", "modelDistribution", "projectDistribution", "sessions"] as const) {
      expect(resolveDashboardScope(DASHBOARD_SCOPE_POLICIES[key], "30d", filters)).toEqual({
        range: "30d",
        filters: { models: ["a", "b"], projects: [{ kind: "project", project_path: "/repo" }] },
      });
    }
    expect(resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.skillsUsage, "year", filters).range).toBe("7d");
  });
});
''',
)

# ---------------------------------------------------------------------------
# Track E: chart data shaping + UI
# ---------------------------------------------------------------------------
write(
    "frontend/src/dashboard/charts/distribution.ts",
    '''import type { EstimatedCostStatus } from "../../data/types";

export type DistributionMetric = "tokens" | "cost";
export type DistributionItem = {
  id: string;
  label: string;
  totalTokens: number;
  estimatedCost: number | null;
  estimatedCostStatus: EstimatedCostStatus;
  title?: string;
};
export type DistributionSegment = DistributionItem & { value: number; percentage: number; isOther?: boolean };

export function buildDistribution(items: DistributionItem[], metric: DistributionMetric) {
  const known = metric === "tokens" ? items : items.filter((item) => item.estimatedCost !== null);
  const unknown = metric === "cost" ? items.filter((item) => item.estimatedCost === null) : [];
  const valueOf = (item: DistributionItem) => metric === "tokens" ? item.totalTokens : item.estimatedCost ?? 0;
  const sorted = [...known].sort((a, b) => valueOf(b) - valueOf(a) || a.label.localeCompare(b.label));
  const total = sorted.reduce((sum, item) => sum + valueOf(item), 0);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  const visible: Array<DistributionItem & { value: number; isOther?: boolean }> = top.map((item) => ({ ...item, value: valueOf(item) }));
  if (rest.length > 0) {
    visible.push({
      id: "__other__",
      label: "其他",
      totalTokens: rest.reduce((sum, item) => sum + item.totalTokens, 0),
      estimatedCost: metric === "cost" ? rest.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0) : null,
      estimatedCostStatus: "complete",
      value: rest.reduce((sum, item) => sum + valueOf(item), 0),
      isOther: true,
    });
  }
  const segments: DistributionSegment[] = visible.map((item) => ({
    ...item,
    percentage: total > 0 ? item.value / total : 0,
  }));
  return { total, segments, unknown };
}
''',
)
write(
    "frontend/src/dashboard/charts/distribution.test.ts",
    '''import { describe, expect, it } from "vitest";
import { buildDistribution, type DistributionItem } from "./distribution";

const items: DistributionItem[] = Array.from({ length: 7 }, (_, index) => ({
  id: `m${index}`,
  label: `m${index}`,
  totalTokens: 70 - index * 10,
  estimatedCost: index === 6 ? null : 7 - index,
  estimatedCostStatus: index === 6 ? "unknown" : "complete",
}));

describe("distribution ranking", () => {
  it("uses Top 5 + Other and excludes unknown costs from cost denominator", () => {
    const tokens = buildDistribution(items, "tokens");
    expect(tokens.segments).toHaveLength(6);
    expect(tokens.segments.at(-1)?.label).toBe("其他");
    const cost = buildDistribution(items, "cost");
    expect(cost.unknown.map((item) => item.id)).toEqual(["m6"]);
    expect(cost.total).toBe(27);
  });
});
''',
)
write(
    "frontend/src/dashboard/charts/DistributionDonutCard.tsx",
    '''import { useMemo, useState } from "react";
import { buildDistribution, type DistributionItem, type DistributionMetric } from "./distribution";

const PALETTE = ["#5576d9", "#5aa888", "#d08a4b", "#986fc1", "#d85d75", "#5c9eb4", "#9b9b63"];

function colorFor(id: string, index: number) {
  if (id === "__other__") return "#a4a8b0";
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[(hash + index) % PALETTE.length];
}

function formatValue(metric: DistributionMetric, value: number) {
  if (metric === "cost") return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  return new Intl.NumberFormat("zh-CN", { notation: value >= 100000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export function DistributionDonutCard({ title, items }: { title: string; items: DistributionItem[] }) {
  const [metric, setMetric] = useState<DistributionMetric>("tokens");
  const data = useMemo(() => buildDistribution(items, metric), [items, metric]);
  let offset = 0;
  return (
    <article className="chart-card distribution-card">
      <header className="chart-card-header">
        <h2>{title}</h2>
        <div className="chart-segmented" aria-label={`${title}统计口径`}>
          <button type="button" className={metric === "tokens" ? "active" : ""} onClick={() => setMetric("tokens")}>Token</button>
          <button type="button" className={metric === "cost" ? "active" : ""} onClick={() => setMetric("cost")}>费用</button>
        </div>
      </header>
      <div className="distribution-body">
        <div className="donut-wrap">
          <svg className="donut-chart" viewBox="0 0 120 120" role="img" aria-label={`${title}${metric === "tokens" ? "Token" : "费用"}分布`}>
            <circle className="donut-track" cx="60" cy="60" r="48" pathLength="100" />
            {data.segments.filter((segment) => segment.percentage > 0).map((segment, index) => {
              const percent = segment.percentage * 100;
              const current = offset;
              offset += percent;
              return <circle key={segment.id} className="donut-segment" cx="60" cy="60" r="48" pathLength="100"
                style={{ stroke: colorFor(segment.id, index), strokeDasharray: `${percent} ${100 - percent}`, strokeDashoffset: -current }} />;
            })}
          </svg>
          <div className="donut-center"><strong>{formatValue(metric, data.total)}</strong><span>{metric === "tokens" ? "Token" : "已知费用"}</span></div>
        </div>
        <div className="distribution-legend">
          {data.segments.map((segment, index) => (
            <div className="legend-row" key={segment.id} title={segment.title}>
              <span className="legend-dot" style={{ background: colorFor(segment.id, index) }} />
              <span className="legend-name">{segment.label}</span>
              <span className="legend-value">{formatValue(metric, segment.value)}</span>
              <span className="legend-percent">{(segment.percentage * 100).toFixed(1)}%</span>
            </div>
          ))}
          {metric === "cost" && data.unknown.map((item, index) => (
            <div className="legend-row legend-unknown" key={item.id} title={item.title}>
              <span className="legend-dot" style={{ background: colorFor(item.id, index + data.segments.length) }} />
              <span className="legend-name">{item.label}</span><span className="legend-value">—</span><span className="legend-percent">—</span>
            </div>
          ))}
          {data.segments.length === 0 && data.unknown.length === 0 ? <div className="chart-empty">暂无数据</div> : null}
        </div>
      </div>
    </article>
  );
}
''',
)
write(
    "frontend/src/dashboard/charts/SkillsUsageChart.tsx",
    '''import { useMemo, useState } from "react";
import type { SkillsUsageResponse } from "../../data/types";

const PALETTE = ["#5576d9", "#5aa888", "#d08a4b", "#986fc1", "#d85d75", "#5c9eb4", "#9b9b63", "#bf6d4d"];
function colorFor(name: string, index: number) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[(hash + index) % PALETTE.length];
}

export function SkillsUsageChart({ response }: { response: SkillsUsageResponse | null }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const data = useMemo(() => {
    const days = response?.days ?? [];
    const skills = [...new Set(days.flatMap((day) => day.skills.map((skill) => skill.skill_name)))].sort();
    const counts = skills.map((name) => days.map((day) => day.skills.find((skill) => skill.skill_name === name)?.count ?? 0));
    return { days, skills, counts, max: Math.max(1, ...days.map((day) => day.total)) };
  }, [response]);
  if (response?.data_status === "rebuilding") {
    return <article className="chart-card skills-card"><header className="chart-card-header"><h2>Skills 用量</h2><span className="chart-note">最近 7 天</span></header><div className="chart-empty">Skills 数据同步中…</div></article>;
  }
  const width = 760, height = 260, left = 42, right = 18, top = 18, bottom = 38;
  const plotW = width - left - right, plotH = height - top - bottom;
  const x = (index: number) => left + (data.days.length <= 1 ? 0 : (index * plotW) / (data.days.length - 1));
  const y = (value: number) => top + plotH - (value / data.max) * plotH;
  const lower = Array(data.days.length).fill(0) as number[];
  const areas = data.skills.map((skill, skillIndex) => {
    const upper = lower.map((value, dayIndex) => value + data.counts[skillIndex][dayIndex]);
    const topPath = upper.map((value, dayIndex) => `${dayIndex === 0 ? "M" : "L"}${x(dayIndex)},${y(value)}`).join(" ");
    const bottomPath = lower.map((value, dayIndex) => [dayIndex, value] as const).reverse().map(([dayIndex, value]) => `L${x(dayIndex)},${y(value)}`).join(" ");
    const path = `${topPath} ${bottomPath} Z`;
    lower.splice(0, lower.length, ...upper);
    return { skill, path, color: colorFor(skill, skillIndex) };
  });
  const hoverDay = hovered === null ? null : data.days[hovered];
  return (
    <article className="chart-card skills-card">
      <header className="chart-card-header"><h2>Skills 用量</h2><span className="chart-note">最近 7 个自然日</span></header>
      {data.days.length === 7 ? <div className="skills-chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} className="skills-chart" role="img" aria-label="最近 7 天 Skills 使用次数">
          <line x1={left} y1={top + plotH} x2={width - right} y2={top + plotH} className="chart-axis" />
          {areas.map((area) => <path key={area.skill} d={area.path} fill={area.color} fillOpacity="0.72" />)}
          {data.days.map((day, index) => <g key={day.date}>
            <text x={x(index)} y={height - 14} textAnchor="middle" className="chart-label">{day.date.slice(5)}</text>
            <rect x={Math.max(left, x(index) - plotW / 14)} y={top} width={plotW / 7} height={plotH} fill="transparent"
              onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} />
          </g>)}
          {hovered !== null ? <line x1={x(hovered)} y1={top} x2={x(hovered)} y2={top + plotH} className="chart-hover-line" /> : null}
        </svg>
        {hoverDay ? <div className="skills-tooltip"><strong>{hoverDay.date}</strong><span>合计 {hoverDay.total} 次</span>{[...hoverDay.skills].sort((a,b) => b.count-a.count || a.skill_name.localeCompare(b.skill_name)).map((skill) => <span key={skill.skill_name}>{skill.skill_name} × {skill.count}</span>)}</div> : null}
        <div className="skills-legend">{data.skills.map((skill, index) => <span key={skill}><i style={{ background: colorFor(skill, index) }} />{skill}</span>)}</div>
      </div> : <div className="chart-empty">暂无 Skills 数据</div>}
    </article>
  );
}
''',
)
write(
    "frontend/src/dashboard/charts/useDashboardChartsController.ts",
    '''import { useEffect, useMemo, useState } from "react";
import { miniUsageClient, dashboardQueryKey, type MiniUsageClient } from "../../data/miniUsageClient";
import type { DashboardFilters, ModelDistributionResponse, ProjectDistributionResponse, RangeKey, SkillsUsageResponse } from "../../data/types";
import { DASHBOARD_SCOPE_POLICIES, resolveDashboardScope } from "../scope";

export type DashboardChartsView = {
  models: ModelDistributionResponse | null;
  projects: ProjectDistributionResponse | null;
  skills: SkillsUsageResponse | null;
  loading: boolean;
  error: boolean;
};

export function useDashboardChartsController(args: {
  range: RangeKey;
  filters: DashboardFilters;
  dataRevision: number;
  client?: MiniUsageClient;
}): DashboardChartsView {
  const client = args.client ?? miniUsageClient;
  const filterKey = useMemo(() => dashboardQueryKey(args.range, args.filters), [args.range, args.filters]);
  const [view, setView] = useState<DashboardChartsView>({ models: null, projects: null, skills: null, loading: true, error: false });
  useEffect(() => {
    const controller = new AbortController();
    const modelScope = resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.modelDistribution, args.range, args.filters);
    const projectScope = resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.projectDistribution, args.range, args.filters);
    const skillsScope = resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.skillsUsage, args.range, args.filters);
    setView((current) => ({ ...current, loading: true, error: false }));
    void Promise.all([
      client.modelDistribution(modelScope.range, modelScope.filters, controller.signal),
      client.projectDistribution(projectScope.range, projectScope.filters, controller.signal),
      client.skillsUsage(skillsScope.range, skillsScope.filters, controller.signal),
    ]).then(
      ([models, projects, skills]) => {
        if (!controller.signal.aborted) setView({ models, projects, skills, loading: false, error: false });
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setView((current) => ({ ...current, loading: false, error: true }));
        }
      },
    );
    return () => controller.abort();
  }, [client, args.dataRevision, args.range, filterKey]);
  return view;
}
''',
)
write(
    "frontend/src/dashboard/charts/ChartSection.tsx",
    '''import { DistributionDonutCard } from "./DistributionDonutCard";
import { SkillsUsageChart } from "./SkillsUsageChart";
import type { DashboardChartsView } from "./useDashboardChartsController";

export function ChartSection({ view }: { view: DashboardChartsView }) {
  const modelItems = (view.models?.items ?? []).map((item) => ({
    id: item.model, label: item.model, totalTokens: item.usage.total_tokens,
    estimatedCost: item.usage.estimated_cost, estimatedCostStatus: item.usage.estimated_cost_status,
  }));
  const projectItems = (view.projects?.items ?? []).map((item) => {
    const label = item.kind === "project" ? item.project_name ?? "未识别项目" : item.kind === "projectless" ? "无项目会话" : "未识别项目";
    return {
      id: item.kind === "project" ? item.project_path ?? label : item.kind,
      label,
      title: item.project_path ?? undefined,
      totalTokens: item.usage.total_tokens,
      estimatedCost: item.usage.estimated_cost,
      estimatedCostStatus: item.usage.estimated_cost_status,
    };
  });
  return <section className="charts-section" aria-label="使用分布图表" aria-busy={view.loading}>
    {view.error ? <div className="charts-error" role="status">图表数据加载失败</div> : null}
    <div className="distribution-grid">
      <DistributionDonutCard title="模型分布" items={modelItems} />
      <DistributionDonutCard title="项目分布" items={projectItems} />
    </div>
    <SkillsUsageChart response={view.skills} />
  </section>;
}
''',
)
# Dashboard controller exposes data revision and resolves KPI through registry.
replace_once(
    "frontend/src/dashboard/useDashboardController.ts",
    """import { createRevisionFeed, type RevisionEventSource, type RevisionFeed } from \"../data/revisionFeed\";""",
    """import { createRevisionFeed, type RevisionEventSource, type RevisionFeed } from \"../data/revisionFeed\";
import { DASHBOARD_SCOPE_POLICIES, resolveDashboardScope } from \"./scope\";""",
)
replace_once(
    "frontend/src/dashboard/useDashboardController.ts",
    """  metrics: SummaryResponse[\"usage\"] | null;
  last_scan_completed_at_ms:""",
    """  metrics: SummaryResponse[\"usage\"] | null;
  data_revision: number;
  last_scan_completed_at_ms:""",
)
# Resolve KPI scope inside loadSummary; behavior remains dashboard-following.
replace_once(
    "frontend/src/dashboard/useDashboardController.ts",
    """      const canonicalFilters = canonicalDashboardFilters(filters);
      const queryKey = dashboardQueryKey(range, canonicalFilters);""",
    """      const scope = resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.kpi, range, filters);
      const canonicalFilters = canonicalDashboardFilters(scope.filters);
      const queryKey = dashboardQueryKey(scope.range, canonicalFilters);""",
)
replace_once(
    "frontend/src/dashboard/useDashboardController.ts",
    """      void client.summary(range, canonicalFilters, controller.signal).then(""",
    """      void client.summary(scope.range, canonicalFilters, controller.signal).then(""",
)
replace_once(
    "frontend/src/dashboard/useDashboardController.ts",
    """          if (response.range.key !== range || queryKey !== dashboardQueryKey(stateRef.current.range, stateRef.current.filters)) {""",
    """          if (response.range.key !== scope.range || queryKey !== dashboardQueryKey(stateRef.current.range, stateRef.current.filters)) {""",
)
replace_once(
    "frontend/src/dashboard/useDashboardController.ts",
    """    metrics: current?.usage ?? null,
    last_scan_completed_at_ms:""",
    """    metrics: current?.usage ?? null,
    data_revision: current?.data_revision ?? 0,
    last_scan_completed_at_ms:""",
)
# Dashboard page uses session scope and chart section.
replace_once(
    "frontend/src/dashboard/DashboardPage.tsx",
    """import { formatLastSyncTime } from \"./format\";""",
    """import { formatLastSyncTime } from \"./format\";
import { DASHBOARD_SCOPE_POLICIES, resolveDashboardScope } from \"./scope\";
import { ChartSection } from \"./charts/ChartSection\";
import { useDashboardChartsController } from \"./charts/useDashboardChartsController\";""",
)
replace_once(
    "frontend/src/dashboard/DashboardPage.tsx",
    """  const view = useDashboardController({ ...options, revisionFeed: feedRef.current });
  const sessions = useSessionTableController(view.range, view.filters, { client: options?.client, revisionFeed: feedRef.current });
  const detail = useSessionDetailController(view.range, view.filters, {""",
    """  const view = useDashboardController({ ...options, revisionFeed: feedRef.current });
  const sessionScope = resolveDashboardScope(DASHBOARD_SCOPE_POLICIES.sessions, view.range, view.filters);
  const sessions = useSessionTableController(sessionScope.range, sessionScope.filters, { client: options?.client, revisionFeed: feedRef.current });
  const detail = useSessionDetailController(sessionScope.range, sessionScope.filters, {""",
)
replace_once(
    "frontend/src/dashboard/DashboardPage.tsx",
    """  useEffect(() => () => feedRef.current?.dispose(), []);
  const loading =""",
    """  const charts = useDashboardChartsController({ range: view.range, filters: view.filters, dataRevision: view.data_revision, client: options?.client });
  useEffect(() => () => feedRef.current?.dispose(), []);
  const loading =""",
)
replace_once(
    "frontend/src/dashboard/DashboardPage.tsx",
    """        </section>
        <SessionSection view={sessions} detail={detail} />""",
    """        </section>
        <ChartSection view={charts} />
        <SessionSection view={sessions} detail={detail} />""",
)

# CSS for chart components.
with (ROOT / "frontend/src/index.css").open("a", encoding="utf-8") as handle:
    handle.write(r'''

/* v0.1.3 Dashboard analytics */
.charts-section { display: grid; gap: 16px; margin: 18px 0; }
.distribution-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.chart-card { border: 1px solid var(--border-color, #e6e8ec); border-radius: 14px; background: var(--surface-color, #fff); padding: 18px; min-width: 0; }
.chart-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.chart-card-header h2 { margin: 0; font-size: 15px; font-weight: 650; }
.chart-note { font-size: 12px; opacity: .62; }
.chart-segmented { display: inline-flex; padding: 2px; border: 1px solid var(--border-color, #e6e8ec); border-radius: 8px; }
.chart-segmented button { border: 0; background: transparent; padding: 4px 9px; border-radius: 6px; font-size: 12px; cursor: pointer; }
.chart-segmented button.active { background: rgba(100,110,130,.12); font-weight: 600; }
.distribution-body { display: grid; grid-template-columns: minmax(150px, .75fr) minmax(190px, 1.25fr); gap: 20px; align-items: center; }
.donut-wrap { position: relative; width: min(100%, 180px); aspect-ratio: 1; margin: 0 auto; }
.donut-chart { width: 100%; height: 100%; transform: rotate(-90deg); }
.donut-track,.donut-segment { fill: none; stroke-width: 12; }
.donut-track { stroke: rgba(120,125,135,.12); }
.donut-segment { transition: stroke-dasharray .18s ease; }
.donut-center { position: absolute; inset: 31%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.donut-center strong { font-size: 15px; line-height: 1.15; }
.donut-center span { margin-top: 4px; font-size: 10px; opacity: .58; }
.distribution-legend { display: grid; gap: 8px; min-width: 0; }
.legend-row { display: grid; grid-template-columns: 10px minmax(0,1fr) auto 48px; gap: 8px; align-items: center; font-size: 12px; }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.legend-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.legend-value,.legend-percent { text-align: right; font-variant-numeric: tabular-nums; }
.legend-percent { opacity: .58; }
.legend-unknown { opacity: .72; }
.skills-card { position: relative; }
.skills-chart-wrap { position: relative; }
.skills-chart { width: 100%; height: auto; min-height: 220px; overflow: visible; }
.chart-axis { stroke: rgba(120,125,135,.28); stroke-width: 1; }
.chart-label { fill: currentColor; opacity: .58; font-size: 11px; }
.chart-hover-line { stroke: currentColor; stroke-width: 1; stroke-dasharray: 4 4; opacity: .35; }
.skills-tooltip { position: absolute; right: 16px; top: 10px; z-index: 2; display: grid; gap: 3px; min-width: 150px; padding: 10px 12px; border: 1px solid var(--border-color,#e6e8ec); border-radius: 8px; background: var(--surface-color,#fff); box-shadow: 0 8px 28px rgba(20,25,35,.12); font-size: 11px; pointer-events: none; }
.skills-tooltip strong { font-size: 12px; }
.skills-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 11px; }
.skills-legend span { display: inline-flex; align-items: center; gap: 5px; }
.skills-legend i { width: 8px; height: 8px; border-radius: 2px; }
.chart-empty,.charts-error { padding: 32px 12px; text-align: center; font-size: 12px; opacity: .6; }
.charts-error { padding: 8px 12px; border-radius: 8px; background: rgba(190,70,70,.08); color: #a13e3e; opacity: 1; }
@media (max-width: 900px) { .distribution-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .distribution-body { grid-template-columns: 1fr; } .legend-row { grid-template-columns: 10px minmax(0,1fr) auto 42px; } }
''')

# ---------------------------------------------------------------------------
# Tests/fixtures and version
# ---------------------------------------------------------------------------
# Replace old range keys throughout frontend source/tests; these strings are
# protocol literals, not arbitrary prose.
for path in (ROOT / "frontend/src").rglob("*.ts*"):
    text = path.read_text(encoding="utf-8")
    updated = text.replace('"week"', '"7d"').replace('"month"', '"30d"')
    if updated != text:
        path.write_text(updated, encoding="utf-8")

# Existing Rust test references to enum variants are protocol-facing.
for path in [ROOT / "src/range/tests/spec05_p2.rs"]:
    if path.exists():
        text = path.read_text(encoding="utf-8").replace("RangeKey::Week", "RangeKey::SevenDays").replace("RangeKey::Month", "RangeKey::ThirtyDays")
        path.write_text(text, encoding="utf-8")

# Bump package version; no dependencies change.
replace_once("Cargo.toml", 'version = "0.1.2"', 'version = "0.1.3"')
lock = read("Cargo.lock")
pattern = r'(name = "mini-usage"\nversion = ")0\.1\.2(")'
lock, count = re.subn(pattern, r'\g<1>0.1.3\2', lock, count=1)
if count != 1:
    raise RuntimeError("Cargo.lock: mini-usage 0.1.2 package entry not found")
write("Cargo.lock", lock)

# Guard against accidentally retaining the old public range keys in the main
# frontend protocol seam.
if '"week"' in read("frontend/src/data/types.ts") or '"month"' in read("frontend/src/data/types.ts"):
    raise RuntimeError("old range protocol keys remain")

print("v0.1.3 implementation applied")
