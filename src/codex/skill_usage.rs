//! Privacy-safe Skill invocation extraction from complete Codex rollout lines.
//!
//! Raw tool payloads are inspected transiently and are never retained. Skill
//! locators are parsed as strings so Windows and Unix forms produce identical
//! results without touching the filesystem or depending on permissions.

use std::collections::BTreeSet;

use chrono::DateTime;
use serde_json::{Map, Value};

use super::CompleteUsageLine;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillUsageEvidence {
    pub occurred_at_ms: i64,
    pub skill_names: Vec<String>,
}

pub struct SkillUsageParser;

impl SkillUsageParser {
    pub fn parse_line(&self, line: &CompleteUsageLine) -> Option<SkillUsageEvidence> {
        if !line
            .json_bytes()
            .windows(b"SKILL.md".len())
            .any(|window| window == b"SKILL.md")
        {
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

        let mut canonical_paths = BTreeSet::new();
        collect_explicit_locator_fields(item_type, payload, &mut canonical_paths);
        if canonical_paths.is_empty() {
            return None;
        }
        let skill_names = canonical_paths
            .into_iter()
            .filter_map(|path| skill_name_from_canonical_path(&path).map(ToOwned::to_owned))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        (!skill_names.is_empty()).then_some(SkillUsageEvidence {
            occurred_at_ms,
            skill_names,
        })
    }
}

fn collect_explicit_locator_fields(
    item_type: &str,
    payload: &Map<String, Value>,
    output: &mut BTreeSet<String>,
) {
    match item_type {
        "custom_tool_call" => {
            if let Some(input) = payload.get("input").and_then(Value::as_str) {
                extract_canonical_paths(input, output);
            }
        }
        "function_call" => {
            if let Some(arguments) = payload.get("arguments") {
                collect_function_arguments(arguments, output);
            }
        }
        "local_shell_call" | "shell_call" => {
            collect_named_string(payload.get("command"), output);
            collect_named_string(payload.get("cmd"), output);
            if let Some(action) = payload.get("action").and_then(Value::as_object) {
                collect_named_string(action.get("command"), output);
                collect_named_string(action.get("cmd"), output);
                collect_named_string(action.get("path"), output);
            }
        }
        _ => {}
    }
}

fn collect_function_arguments(arguments: &Value, output: &mut BTreeSet<String>) {
    let parsed;
    let object = match arguments {
        Value::Object(object) => Some(object),
        Value::String(text) => {
            parsed = serde_json::from_str::<Value>(text).ok();
            parsed.as_ref().and_then(Value::as_object)
        }
        _ => None,
    };
    let Some(object) = object else {
        return;
    };
    for key in ["command", "cmd", "path", "file_path", "filepath"] {
        collect_named_string(object.get(key), output);
    }
}

fn collect_named_string(value: Option<&Value>, output: &mut BTreeSet<String>) {
    match value {
        Some(Value::String(text)) => extract_canonical_paths(text, output),
        Some(Value::Array(values)) => {
            for value in values {
                if let Some(text) = value.as_str() {
                    extract_canonical_paths(text, output);
                }
            }
        }
        _ => {}
    }
}

fn extract_canonical_paths(text: &str, output: &mut BTreeSet<String>) {
    let normalized = text.replace('\\', "/");
    let mut cursor = 0usize;
    while let Some(relative) = normalized[cursor..].find("SKILL.md") {
        let end = cursor + relative + "SKILL.md".len();
        let prefix = &normalized[..cursor + relative];
        if let Some(skills_index) = prefix.rfind("/skills/") {
            let name = prefix[skills_index + "/skills/".len()..].trim_end_matches('/');
            if valid_skill_name(name) {
                output.insert(format!("{}/skills/{name}/SKILL.md", &prefix[..skills_index]));
            }
        }
        cursor = end;
        if cursor >= normalized.len() {
            break;
        }
    }
}

fn skill_name_from_canonical_path(path: &str) -> Option<&str> {
    let suffix = path.strip_suffix("/SKILL.md")?;
    let (prefix, name) = suffix.rsplit_once('/')?;
    prefix.ends_with("/skills").then_some(name)
}

fn valid_skill_name(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.len() <= 128
        && !value.chars().any(char::is_control)
        && !value
            .chars()
            .any(|character| matches!(character, '/' | '\\'))
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
    fn canonical_skill_locators_are_cross_platform_and_deduplicated_per_call() {
        let parser = SkillUsageParser;
        let parsed = parser
            .parse_line(&line(
                r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"custom_tool_call","input":"cat /Users/me/.codex/skills/frontend-skill/SKILL.md && type C:\\Users\\me\\.codex\\skills\\diagnosing-bugs\\SKILL.md && cat /Users/me/.codex/skills/frontend-skill/SKILL.md"}}"#,
            ))
            .unwrap();
        assert_eq!(
            parsed.skill_names,
            vec!["diagnosing-bugs", "frontend-skill"]
        );
    }

    #[test]
    fn arbitrary_payload_strings_are_not_skill_evidence() {
        let parser = SkillUsageParser;
        assert!(
            parser
                .parse_line(&line(
                    r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"function_call","arguments":{"code":"const r = '/Users/me/.codex/skills/not-a-skill/SKILL.md'"}}}"#,
                ))
                .is_none()
        );
    }

    #[test]
    fn function_command_field_accepts_only_canonical_skill_path() {
        let parser = SkillUsageParser;
        let parsed = parser
            .parse_line(&line(
                r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"function_call","arguments":"{\"command\":\"cat /x/skills/foo/SKILL.md\"}"}}"#,
            ))
            .unwrap();
        assert_eq!(parsed.skill_names, vec!["foo"]);
    }

    #[test]
    fn listing_message_and_missing_timestamp_are_not_usage() {
        let parser = SkillUsageParser;
        assert!(
            parser
                .parse_line(&line(
                    r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"message","content":"<skills_instructions>/x/skills/foo/SKILL.md</skills_instructions>"}}"#,
                ))
                .is_none()
        );
        assert!(
            parser
                .parse_line(&line(
                    r#"{"type":"response_item","payload":{"type":"custom_tool_call","input":"cat /x/skills/foo/SKILL.md"}}"#,
                ))
                .is_none()
        );
    }
}
