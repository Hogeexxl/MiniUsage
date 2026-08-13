//! Streaming, title-only adapter for Codex's `session_index.jsonl`.
//!
//! A line is decoded and immediately reduced to an allow-listed
//! `SessionNameFact`; the raw JSON value never leaves the line-processing
//! function.  This keeps the compatibility source useful without making it a
//! second thread database or a place where message text can leak.

use std::{
    collections::BTreeMap,
    fmt,
    fs::File,
    io::{self, BufRead, BufReader},
    path::Path,
};

use chrono::DateTime;
use serde_json::Value;

use super::{DiagnosticSeverity, SourceAvailability};

const DEFAULT_MAX_LINE_BYTES: usize = 1024 * 1024;
const DEFAULT_MAX_TITLE_BYTES: usize = 16 * 1024;
const MAX_REASONABLE_EPOCH_MS: i64 = 253_402_300_799_999;

/// A privacy-safe diagnostic.  In particular, malformed rows are identified
/// by line/offset and code rather than by echoing the row or serde's input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionIndexDiagnostic {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub line_number: u64,
    pub source_start_offset: u64,
    pub thread_id: Option<String>,
    pub field: Option<String>,
    pub source_kind: &'static str,
}

impl SessionIndexDiagnostic {
    fn new(
        code: impl Into<String>,
        severity: DiagnosticSeverity,
        line_number: u64,
        source_start_offset: u64,
    ) -> Self {
        Self {
            code: code.into(),
            severity,
            line_number,
            source_start_offset,
            thread_id: None,
            field: None,
            source_kind: "session_index_jsonl",
        }
    }

    fn field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }

    fn thread(mut self, thread_id: impl Into<String>) -> Self {
        self.thread_id = Some(thread_id.into());
        self
    }
}

/// A title candidate from one complete JSONL object.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionNameFact {
    pub thread_id: String,
    pub thread_name: String,
    pub updated_at_ms: Option<i64>,
}

impl SessionNameFact {
    pub fn id(&self) -> &str {
        &self.thread_id
    }

    pub fn title(&self) -> &str {
        &self.thread_name
    }
}

/// Whether the whole compatibility file was consumed.  A trailing half-line
/// is deliberately not a fact, but it also need not hide prior complete rows.
pub type SessionSourceStatus = SourceAvailability;

/// One complete snapshot.  `names` is a deterministic map; `facts` is the
/// same selected set in ID order for callers that prefer a sequence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionNameSnapshot {
    pub names: BTreeMap<String, SessionNameFact>,
    pub facts: Vec<SessionNameFact>,
    pub diagnostics: Vec<SessionIndexDiagnostic>,
    pub status: SessionSourceStatus,
}

impl SessionNameSnapshot {
    pub fn get(&self, thread_id: &str) -> Option<&SessionNameFact> {
        self.names.get(thread_id)
    }

    pub fn is_complete(&self) -> bool {
        self.status.is_complete()
    }
}

#[derive(Debug)]
pub enum SessionIndexError {
    Io(io::Error),
}

impl fmt::Display for SessionIndexError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(_) => formatter.write_str("session index could not be read"),
        }
    }
}

impl std::error::Error for SessionIndexError {}

impl From<io::Error> for SessionIndexError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Streaming reader for the title compatibility source.
#[derive(Clone, Copy, Debug)]
pub struct SessionIndexReader {
    max_line_bytes: usize,
    max_title_bytes: usize,
}

impl Default for SessionIndexReader {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionIndexReader {
    pub const fn new() -> Self {
        Self {
            max_line_bytes: DEFAULT_MAX_LINE_BYTES,
            max_title_bytes: DEFAULT_MAX_TITLE_BYTES,
        }
    }

    pub const fn with_limits(max_line_bytes: usize, max_title_bytes: usize) -> Self {
        Self {
            max_line_bytes,
            max_title_bytes,
        }
    }

    pub fn read_snapshot<R: BufRead>(reader: R) -> Result<SessionNameSnapshot, SessionIndexError> {
        Self::new().read_snapshot_with_options(reader)
    }

    pub fn read_snapshot_with_options<R: BufRead>(
        self,
        mut reader: R,
    ) -> Result<SessionNameSnapshot, SessionIndexError> {
        let mut names = BTreeMap::new();
        let mut diagnostics = Vec::new();
        let mut source_offset = 0_u64;
        let mut line_number = 0_u64;
        let mut status = SessionSourceStatus::Complete;

        loop {
            let line_start = source_offset;
            let Some(line) = read_line_bounded(&mut reader, self.max_line_bytes)? else {
                break;
            };
            source_offset = source_offset.saturating_add(line.consumed_bytes as u64);
            line_number = line_number.saturating_add(1);

            if !line.terminated {
                status = SessionSourceStatus::Partial;
                diagnostics.push(SessionIndexDiagnostic::new(
                    "half_line",
                    DiagnosticSeverity::Warning,
                    line_number,
                    line_start,
                ));
                // A partial final line is never a complete source fact.
                break;
            }
            if line.oversized {
                diagnostics.push(SessionIndexDiagnostic::new(
                    "line_too_large",
                    DiagnosticSeverity::Warning,
                    line_number,
                    line_start,
                ));
                continue;
            }

            let mut bytes = line.bytes;
            if bytes.last() == Some(&b'\n') {
                bytes.pop();
            }
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            if bytes.iter().all(u8::is_ascii_whitespace) {
                diagnostics.push(SessionIndexDiagnostic::new(
                    "empty_line",
                    DiagnosticSeverity::Info,
                    line_number,
                    line_start,
                ));
                continue;
            }

            let value: Value = match serde_json::from_slice(&bytes) {
                Ok(value) => value,
                Err(_) => {
                    diagnostics.push(SessionIndexDiagnostic::new(
                        "invalid_json",
                        DiagnosticSeverity::Warning,
                        line_number,
                        line_start,
                    ));
                    continue;
                }
            };
            let Some(object) = value.as_object() else {
                diagnostics.push(SessionIndexDiagnostic::new(
                    "record_not_object",
                    DiagnosticSeverity::Warning,
                    line_number,
                    line_start,
                ));
                continue;
            };

            let Some(id) = object.get("id").and_then(Value::as_str).map(str::trim) else {
                diagnostics.push(
                    SessionIndexDiagnostic::new(
                        "missing_id",
                        DiagnosticSeverity::Warning,
                        line_number,
                        line_start,
                    )
                    .field("id"),
                );
                continue;
            };
            if !valid_identifier(id) {
                diagnostics.push(
                    SessionIndexDiagnostic::new(
                        "invalid_id",
                        DiagnosticSeverity::Warning,
                        line_number,
                        line_start,
                    )
                    .field("id"),
                );
                continue;
            }

            let Some(thread_name) = object
                .get("thread_name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
            else {
                diagnostics.push(
                    SessionIndexDiagnostic::new(
                        "missing_title",
                        DiagnosticSeverity::Warning,
                        line_number,
                        line_start,
                    )
                    .thread(id)
                    .field("thread_name"),
                );
                continue;
            };
            if thread_name.len() > self.max_title_bytes || thread_name.chars().any(char::is_control)
            {
                diagnostics.push(
                    SessionIndexDiagnostic::new(
                        if thread_name.len() > self.max_title_bytes {
                            "title_too_large"
                        } else {
                            "invalid_title"
                        },
                        DiagnosticSeverity::Warning,
                        line_number,
                        line_start,
                    )
                    .thread(id)
                    .field("thread_name"),
                );
                continue;
            }

            let updated_at_ms = match object.get("updated_at") {
                None | Some(Value::Null) => None,
                Some(value) => match parse_updated_at(value) {
                    Some(value) => Some(value),
                    None => {
                        diagnostics.push(
                            SessionIndexDiagnostic::new(
                                "invalid_time",
                                DiagnosticSeverity::Warning,
                                line_number,
                                line_start,
                            )
                            .thread(id)
                            .field("updated_at"),
                        );
                        None
                    }
                },
            };

            let candidate = SessionNameFact {
                thread_id: id.to_owned(),
                thread_name: thread_name.to_owned(),
                updated_at_ms,
            };
            select_candidate(
                &mut names,
                candidate,
                line_number,
                line_start,
                &mut diagnostics,
            );
        }

        let facts = names.values().cloned().collect();
        Ok(SessionNameSnapshot {
            names,
            facts,
            diagnostics,
            status,
        })
    }

    pub fn read_path<P: AsRef<Path>>(
        self,
        path: P,
    ) -> Result<SessionNameSnapshot, SessionIndexError> {
        let file = File::open(path)?;
        self.read_snapshot_with_options(BufReader::new(file))
    }
}

#[derive(Debug)]
struct BoundedLine {
    bytes: Vec<u8>,
    consumed_bytes: usize,
    terminated: bool,
    oversized: bool,
}

/// Consume through one newline while retaining at most `max_bytes` bytes.
/// This avoids allocating an attacker-controlled amount for a malformed line.
fn read_line_bounded<R: BufRead>(
    reader: &mut R,
    max_bytes: usize,
) -> io::Result<Option<BoundedLine>> {
    let mut bytes = Vec::new();
    let mut consumed_bytes = 0usize;
    let mut oversized = false;

    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            if consumed_bytes == 0 {
                return Ok(None);
            }
            return Ok(Some(BoundedLine {
                bytes,
                consumed_bytes,
                terminated: false,
                oversized,
            }));
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(buffer.len(), |index| index + 1);
        if !oversized {
            let remaining = max_bytes.saturating_add(1).saturating_sub(bytes.len());
            let keep = remaining.min(take);
            bytes.extend_from_slice(&buffer[..keep]);
            if bytes.len() > max_bytes {
                oversized = true;
                bytes.clear();
            }
        }
        consumed_bytes = consumed_bytes.saturating_add(take);
        reader.consume(take);
        if newline.is_some() {
            return Ok(Some(BoundedLine {
                bytes,
                consumed_bytes,
                terminated: true,
                oversized,
            }));
        }
    }
}

fn select_candidate(
    names: &mut BTreeMap<String, SessionNameFact>,
    candidate: SessionNameFact,
    line_number: u64,
    source_start_offset: u64,
    diagnostics: &mut Vec<SessionIndexDiagnostic>,
) {
    let id = candidate.thread_id.clone();
    let Some(previous) = names.get(&id) else {
        names.insert(id, candidate);
        return;
    };

    let replace = match (previous.updated_at_ms, candidate.updated_at_ms) {
        (Some(previous), Some(next)) if next > previous => true,
        (Some(previous), Some(next)) if next < previous => false,
        (Some(_), None) => false,
        (None, Some(_)) => true,
        (None, None) => true,
        (Some(_), Some(_)) => {
            if previous.thread_name == candidate.thread_name {
                return;
            }
            diagnostics.push(
                SessionIndexDiagnostic::new(
                    "same_timestamp_conflict",
                    DiagnosticSeverity::Warning,
                    line_number,
                    source_start_offset,
                )
                .thread(&id)
                .field("thread_name"),
            );
            // File order is the deterministic tie breaker required by the
            // source contract.
            true
        }
    };
    if replace {
        names.insert(id, candidate);
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty() && !value.chars().any(char::is_control)
}

fn parse_updated_at(value: &Value) -> Option<i64> {
    if let Some(text) = value.as_str() {
        let parsed = DateTime::parse_from_rfc3339(text.trim()).ok()?;
        let millis = parsed.timestamp_millis();
        return (0..=MAX_REASONABLE_EPOCH_MS)
            .contains(&millis)
            .then_some(millis);
    }
    if let Some(number) = value.as_i64() {
        // The compatibility format is ISO-8601, but accepting integer
        // seconds/milliseconds lets older exports degrade safely.  Values at
        // or above 10^11 are unambiguously milliseconds in current dates.
        if number < 0 {
            return None;
        }
        return if number >= 100_000_000_000 {
            (number <= MAX_REASONABLE_EPOCH_MS).then_some(number)
        } else {
            number
                .checked_mul(1_000)
                .filter(|millis| *millis <= MAX_REASONABLE_EPOCH_MS)
        };
    }
    None
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn read(input: impl AsRef<[u8]>) -> SessionNameSnapshot {
        SessionIndexReader::read_snapshot(Cursor::new(input.as_ref())).unwrap()
    }

    #[test]
    fn parses_and_trims_thread_name_with_rfc3339_time() {
        let snapshot = read(
            br#"{"id":"thread-a","thread_name":"  A  title  ","updated_at":"2026-08-08T01:02:03.456Z","preview":"SECRET"}
"#,
        );

        let fact = snapshot.get("thread-a").unwrap();
        assert_eq!(fact.thread_name, "A  title");
        assert_eq!(fact.updated_at_ms, Some(1_786_150_923_456));
        assert!(!format!("{snapshot:?}").contains("SECRET"));
    }

    #[test]
    fn newer_name_wins_and_a_later_older_row_cannot_replace_it() {
        let snapshot = read(
            br#"{"id":"same","thread_name":"old","updated_at":"2026-01-01T00:00:00Z"}
{"id":"same","thread_name":"new","updated_at":"2026-01-03T00:00:00Z"}
{"id":"same","thread_name":"older-late","updated_at":"2026-01-02T00:00:00Z"}
"#,
        );

        assert_eq!(snapshot.get("same").unwrap().thread_name, "new");
    }

    #[test]
    fn same_timestamp_conflict_uses_the_later_row_and_reports_it() {
        let snapshot = read(
            br#"{"id":"same","thread_name":"first","updated_at":"2026-01-01T00:00:00Z"}
{"id":"same","thread_name":"second","updated_at":"2026-01-01T00:00:00Z"}
"#,
        );

        assert_eq!(snapshot.get("same").unwrap().thread_name, "second");
        assert!(snapshot.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "same_timestamp_conflict"
                && diagnostic.line_number == 2
                && diagnostic.thread_id.as_deref() == Some("same")
        }));
    }

    #[test]
    fn empty_title_and_invalid_json_do_not_block_a_later_valid_row() {
        let snapshot = read(
            br#"{"id":"empty","thread_name":"   "}
{"id":"broken","thread_name":
{"id":"valid","thread_name":"kept"}
"#,
        );

        assert!(snapshot.get("empty").is_none());
        assert!(snapshot.get("broken").is_none());
        assert_eq!(snapshot.get("valid").unwrap().thread_name, "kept");
        assert!(snapshot.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "missing_title" && diagnostic.line_number == 1
        }));
        assert!(snapshot.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "invalid_json" && diagnostic.line_number == 2
        }));
    }

    #[test]
    fn trailing_half_line_is_not_a_fact() {
        let snapshot = read(
            br#"{"id":"complete","thread_name":"complete"}
{"id":"half","thread_name":"must-not-appear"}"#,
        );

        assert_eq!(snapshot.get("complete").unwrap().thread_name, "complete");
        assert!(snapshot.get("half").is_none());
        assert_eq!(snapshot.status, SessionSourceStatus::Partial);
        assert!(
            snapshot
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "half_line")
        );
    }

    #[test]
    fn oversized_line_and_oversized_title_are_rejected_without_truncation() {
        let oversized_line = format!("{}\n", "x".repeat(257));
        let input = format!(
            "{oversized_line}{{\"id\":\"long-title\",\"thread_name\":\"too-long-title\"}}\n\
             {{\"id\":\"valid\",\"thread_name\":\"short\"}}\n"
        );
        let snapshot = SessionIndexReader::with_limits(256, 8)
            .read_snapshot_with_options(Cursor::new(input.as_bytes()))
            .unwrap();

        assert!(snapshot.get("long-title").is_none());
        assert_eq!(snapshot.get("valid").unwrap().thread_name, "short");
        assert!(
            snapshot
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "line_too_large")
        );
        assert!(
            snapshot
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "title_too_large")
        );
    }
}
