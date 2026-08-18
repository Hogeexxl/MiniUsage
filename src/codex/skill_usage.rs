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
        if let Some(name) = before
            .rsplit('/')
            .next()
            .filter(|value| valid_skill_name(value))
        {
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
