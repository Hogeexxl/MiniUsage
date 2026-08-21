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

        if !item_type.ends_with("_call") {
            return None;
        }

        let mut names = BTreeSet::new();
        collect_argument_roots(payload, &mut names);

        (!names.is_empty()).then(|| SkillUsageEvidence {
            occurred_at_ms,
            skill_names: names.into_iter().collect(),
        })
    }
}

fn collect_argument_roots(payload: &serde_json::Map<String, Value>, output: &mut BTreeSet<String>) {
    if let Some(input) = payload.get("input") {
        collect_locator_texts(input, output);
    }

    if let Some(arguments) = payload.get("arguments") {
        if let Value::String(arguments) = arguments {
            match serde_json::from_str::<Value>(arguments) {
                Ok(value) => collect_locator_texts(&value, output),
                Err(_) => extract_from_locator_text(arguments, output),
            }
        } else {
            collect_locator_texts(arguments, output);
        }
    }

    if let Some(action) = payload.get("action") {
        collect_locator_texts(action, output);
    }
}

fn collect_locator_texts(value: &Value, output: &mut BTreeSet<String>) {
    match value {
        Value::String(text) => extract_from_locator_text(text, output),
        Value::Array(values) => {
            for value in values {
                collect_locator_texts(value, output);
            }
        }
        Value::Object(object) => {
            for value in object.values() {
                collect_locator_texts(value, output);
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
        let components: Vec<_> = before
            .split('/')
            .filter(|component| !component.is_empty())
            .collect();
        if let Some(skill_name) = components.last().copied() {
            let ancestors = &components[..components.len() - 1];
            if valid_skill_name(skill_name) && ancestors.contains(&"skills") {
                output.insert(skill_name.to_owned());
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
    use serde_json::json;

    use super::*;

    fn line(json: &str) -> CompleteUsageLine {
        CompleteUsageLine::new(0, format!("{json}\n").into_bytes()).unwrap()
    }

    fn response(payload: &str) -> CompleteUsageLine {
        line(&format!(
            r#"{{"timestamp":"2026-08-19T00:00:00Z","type":"response_item","payload":{payload}}}"#
        ))
    }

    #[test]
    fn t_s07_001_p1_direct_paths_are_cross_platform_and_deduplicated_per_call() {
        let parser = SkillUsageParser;
        let parsed = parser
            .parse_line(&response(
                &json!({
                    "type": "custom_tool_call",
                    "input": "cat /Users/me/.codex/skills/frontend-skill/SKILL.md && type C:\\Users\\me\\.codex\\skills\\diagnosing-bugs\\SKILL.md && cat /Users/me/.codex/skills/frontend-skill/SKILL.md"
                })
                .to_string(),
            ))
            .unwrap();
        assert_eq!(
            parsed.skill_names,
            vec!["diagnosing-bugs", "frontend-skill"]
        );
    }

    #[test]
    fn t_s07_001_p2_intermediate_skill_directory_is_accepted() {
        let parser = SkillUsageParser;
        let parsed = parser
            .parse_line(&response(
                &json!({
                    "type": "custom_tool_call",
                    "input": [
                        {"nested": {"path": "/project/.agents/skills/.system/pdf/SKILL.md"}},
                        {"nested": {"path": "C:\\project\\.agents\\skills\\.system\\pdf\\SKILL.md"}}
                    ]
                })
                .to_string(),
            ))
            .unwrap();
        assert_eq!(parsed.skill_names, vec!["pdf"]);
    }

    #[test]
    fn t_s07_001_p3_function_arguments_recurse_and_malformed_falls_back_to_text() {
        let parser = SkillUsageParser;
        let nested = json!({
            "type": "function_call",
            "arguments": json!({
                "nested": {"files": ["/x/skills/foo/SKILL.md"]}
            })
            .to_string(),
        });
        let parsed = parser.parse_line(&response(&nested.to_string())).unwrap();
        assert_eq!(parsed.skill_names, vec!["foo"]);

        let malformed = json!({
            "type": "function_call",
            "arguments": r#"{"nested":"/x/skills/bar/SKILL.md""#,
        });
        let parsed = parser
            .parse_line(&response(&malformed.to_string()))
            .unwrap();
        assert_eq!(parsed.skill_names, vec!["bar"]);
    }

    #[test]
    fn t_s07_001_p4_future_call_scans_each_argument_root_shape() {
        let parser = SkillUsageParser;
        let nested = json!({
            "type": "some_future_call",
            "input": [{"nested": {"path": "/x/skills/future-input/SKILL.md"}}],
            "arguments": {"nested": ["/x/skills/future-arguments-array/SKILL.md"]},
            "action": {"nested": [{"path": "/x/skills/future-action/SKILL.md"}]},
        });
        let parsed = parser.parse_line(&response(&nested.to_string())).unwrap();
        assert_eq!(
            parsed.skill_names,
            vec!["future-action", "future-arguments-array", "future-input",]
        );

        let array_roots = json!({
            "type": "some_future_call",
            "input": {"nested": {"path": "/x/skills/future-input-object/SKILL.md"}},
            "arguments": ["/x/skills/future-arguments-root-array/SKILL.md"],
            "action": [{"nested": "/x/skills/future-action-root-array/SKILL.md"}],
        });
        let parsed = parser
            .parse_line(&response(&array_roots.to_string()))
            .unwrap();
        assert_eq!(
            parsed.skill_names,
            vec![
                "future-action-root-array",
                "future-arguments-root-array",
                "future-input-object",
            ]
        );

        let action_string = json!({
            "type": "some_future_call",
            "action": "/x/skills/future-action-string/SKILL.md",
        });
        let parsed = parser
            .parse_line(&response(&action_string.to_string()))
            .unwrap();
        assert_eq!(parsed.skill_names, vec!["future-action-string"]);
    }

    #[test]
    fn t_s07_001_p5_false_positive_path_components_are_rejected() {
        let parser = SkillUsageParser;
        let payload = json!({
            "type": "function_call",
            "arguments": [
                "/foo/bar/SKILL.md",
                "/tmp/my-skills-backup/foo/SKILL.md",
                "/tmp/skills-old/foo/SKILL.md",
                "const r = \"SKILL.md\"",
            ],
        });
        assert!(parser.parse_line(&response(&payload.to_string())).is_none());
    }

    #[test]
    fn t_s07_001_p6_unrelated_message_note_and_missing_timestamp_are_ignored() {
        let parser = SkillUsageParser;
        let unrelated = json!({
            "type": "function_call",
            "arguments": {"value": "no skill"},
            "note": "/x/skills/also-false/SKILL.md",
        });
        assert!(
            parser
                .parse_line(&response(&unrelated.to_string()))
                .is_none()
        );
        assert!(parser
            .parse_line(&response(
                &json!({
                    "type": "message",
                    "content": "<skills_instructions>/x/skills/foo/SKILL.md</skills_instructions>"
                })
                .to_string(),
            ))
            .is_none());
        assert!(parser
            .parse_line(&line(
                r#"{"type":"response_item","payload":{"type":"function_call","input":"/x/skills/foo/SKILL.md"}}"#,
            ))
            .is_none());
    }
}
