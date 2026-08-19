//! Privacy-safe Skill invocation extraction from complete Codex rollout lines.
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
        let occurred_at_ms = payload
            .get("timestamp")
            .and_then(parse_timestamp_ms)
            .or_else(|| object.get("timestamp").and_then(parse_timestamp_ms))?;

        let mut names = BTreeSet::new();
        match item_type {
            "custom_tool_call" => {
                if let Some(input) = payload.get("input").and_then(Value::as_str) {
                    extract_from_locator_text(input, &mut names);
                }
            }
            "function_call" => {
                if let Some(arguments) = payload.get("arguments").and_then(Value::as_str) {
                    extract_from_function_arguments(arguments, &mut names);
                }
            }
            "local_shell_call" => {
                if let Some(action) = payload.get("action") {
                    extract_from_shell_action(action, &mut names);
                }
            }
            _ => return None,
        }

        (!names.is_empty()).then(|| SkillUsageEvidence {
            occurred_at_ms,
            skill_names: names.into_iter().collect(),
        })
    }
}

fn extract_from_function_arguments(arguments: &str, output: &mut BTreeSet<String>) {
    let Ok(value) = serde_json::from_str::<Value>(arguments) else {
        return;
    };
    let Some(object) = value.as_object() else {
        return;
    };
    for key in ["command", "cmd", "path", "file_path", "skill_path"] {
        if let Some(value) = object.get(key) {
            extract_explicit_locator_value(value, output);
        }
    }
}

fn extract_from_shell_action(action: &Value, output: &mut BTreeSet<String>) {
    let Some(object) = action.as_object() else {
        return;
    };
    for key in ["command", "cmd"] {
        if let Some(value) = object.get(key) {
            extract_explicit_locator_value(value, output);
        }
    }
}

fn extract_explicit_locator_value(value: &Value, output: &mut BTreeSet<String>) {
    match value {
        Value::String(text) => extract_from_locator_text(text, output),
        Value::Array(values) => {
            for value in values {
                if let Some(text) = value.as_str() {
                    extract_from_locator_text(text, output);
                }
            }
        }
        _ => {}
    }
}

fn extract_from_locator_text(text: &str, output: &mut BTreeSet<String>) {
    let normalized = text.replace('\\', "/");
    let mut cursor = 0usize;
    while let Some(relative) = normalized[cursor..].find("SKILL.md") {
        let index = cursor + relative;
        let before = normalized[..index].trim_end_matches('/');
        let mut components = before.rsplit('/');
        let skill_name = components.next();
        let skills_dir = components.next();
        if skills_dir == Some("skills") {
            if let Some(name) = skill_name.filter(|value| valid_skill_name(value)) {
                output.insert(name.to_owned());
            }
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
    fn t_013_003_skill_locator_is_cross_platform_and_deduplicated_per_call() {
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
    fn canonical_skill_path_is_required() {
        let parser = SkillUsageParser;
        assert!(parser
            .parse_line(&line(
                r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"custom_tool_call","input":"cat /tmp/foo/SKILL.md && const r = 'SKILL.md'"}}"#,
            ))
            .is_none());
        let parsed = parser
            .parse_line(&line(
                r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"custom_tool_call","input":"cat /tmp/skills/foo/SKILL.md"}}"#,
            ))
            .unwrap();
        assert_eq!(parsed.skill_names, vec!["foo"]);
    }

    #[test]
    fn unrelated_payload_strings_are_not_scanned() {
        let parser = SkillUsageParser;
        assert!(parser
            .parse_line(&line(
                r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"function_call","arguments":"{\"value\":\"/tmp/skills/false-positive/SKILL.md\"}","note":"/tmp/skills/also-false/SKILL.md"}}"#,
            ))
            .is_none());
    }

    #[test]
    fn t_013_003_skill_listing_message_and_missing_timestamp_are_not_usage() {
        let parser = SkillUsageParser;
        assert!(parser
            .parse_line(&line(
                r#"{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{"type":"message","content":"<skills_instructions>/x/skills/foo/SKILL.md</skills_instructions>"}}"#,
            ))
            .is_none());
        assert!(parser
            .parse_line(&line(
                r#"{"type":"response_item","payload":{"type":"custom_tool_call","input":"cat /x/skills/foo/SKILL.md"}}"#,
            ))
            .is_none());
    }
}
