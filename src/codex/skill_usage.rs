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
        let occurred_at_ms = payload
            .get("timestamp")
            .and_then(parse_timestamp_ms)
            .or_else(|| object.get("timestamp").and_then(parse_timestamp_ms))?;

        if !item_type.ends_with("_call") {
            return None;
        }

        let mut names = BTreeSet::new();
        collect_call_arguments(item_type, payload, &mut names);

        (!names.is_empty()).then(|| SkillUsageEvidence {
            occurred_at_ms,
            skill_names: names.into_iter().collect(),
        })
    }
}

fn collect_call_arguments(
    item_type: &str,
    payload: &Map<String, Value>,
    output: &mut BTreeSet<String>,
) {
    match item_type {
        "function_call" if payload.get("name").and_then(Value::as_str) == Some("exec_command") => {
            if let Some(arguments) = payload.get("arguments") {
                collect_function_arguments(arguments, output);
            }
        }
        "custom_tool_call" if payload.get("name").and_then(Value::as_str) == Some("exec") => {
            if let Some(input) = payload.get("input").and_then(Value::as_str) {
                collect_js_exec_commands(input, output);
            }
        }
        "local_shell_call" => {
            if let Some(action) = payload.get("action").and_then(Value::as_object) {
                for key in ["cmd", "command"] {
                    if let Some(value) = action.get(key) {
                        collect_command_value(value, output);
                    }
                }
            }
        }
        _ => {}
    }
}

fn collect_function_arguments(arguments: &Value, output: &mut BTreeSet<String>) {
    if let Value::String(text) = arguments {
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return;
        };
        collect_function_argument_object(&value, output);
    } else {
        collect_function_argument_object(arguments, output);
    }
}

fn collect_function_argument_object(value: &Value, output: &mut BTreeSet<String>) {
    let Some(object) = value.as_object() else {
        return;
    };
    for key in ["cmd", "command"] {
        if let Some(value) = object.get(key) {
            collect_command_value(value, output);
        }
    }
}

fn collect_command_value(value: &Value, output: &mut BTreeSet<String>) {
    match value {
        Value::String(text) => extract_from_locator_text(text, output),
        Value::Array(values) => {
            for value in values {
                if let Value::String(text) = value {
                    extract_from_locator_text(text, output);
                }
            }
        }
        _ => {}
    }
}

fn collect_js_exec_commands(input: &str, output: &mut BTreeSet<String>) {
    const MARKER: &str = "tools.exec_command";
    let mut cursor = 0usize;
    while let Some(start) = find_js_code_marker(input, MARKER, cursor) {
        let after_marker = start + MARKER.len();
        let Some(open_offset) = input[after_marker..].find('(') else {
            break;
        };
        let open = after_marker + open_offset;
        let Some(close) = find_js_call_end(input, open) else {
            break;
        };
        if let Some(command) = extract_js_property_string(&input[open + 1..close], "cmd") {
            extract_from_locator_text(&command, output);
        }
        cursor = close.saturating_add(1);
    }
}

fn find_js_code_marker(input: &str, marker: &str, from: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let marker_bytes = marker.as_bytes();
    let mut index = from;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if line_comment {
            if byte == b'\n' {
                line_comment = false;
            }
            index += 1;
            continue;
        }
        if block_comment {
            if byte == b'*' && bytes.get(index + 1) == Some(&b'/') {
                block_comment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == delimiter {
                quote = None;
            }
            index += 1;
            continue;
        }
        if byte == b'\'' || byte == b'"' || byte == b'`' {
            quote = Some(byte);
            index += 1;
            continue;
        }
        if byte == b'/' {
            match bytes.get(index + 1) {
                Some(b'/') => {
                    line_comment = true;
                    index += 2;
                    continue;
                }
                Some(b'*') => {
                    block_comment = true;
                    index += 2;
                    continue;
                }
                _ => {}
            }
        }
        if bytes.get(index..index + marker_bytes.len()) == Some(marker_bytes) {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn find_js_call_end(input: &str, open: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut depth = 0usize;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    for index in open..bytes.len() {
        let byte = bytes[index];
        if line_comment {
            if byte == b'\n' {
                line_comment = false;
            }
            continue;
        }
        if block_comment {
            if byte == b'*' && bytes.get(index + 1) == Some(&b'/') {
                block_comment = false;
            }
            continue;
        }
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == delimiter {
                quote = None;
            }
            continue;
        }
        if byte == b'\'' || byte == b'"' || byte == b'`' {
            quote = Some(byte);
            continue;
        }
        if byte == b'/' {
            match bytes.get(index + 1) {
                Some(b'/') => {
                    line_comment = true;
                    continue;
                }
                Some(b'*') => {
                    block_comment = true;
                    continue;
                }
                _ => {}
            }
        }
        match byte {
            b'(' => depth += 1,
            b')' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_js_property_string(input: &str, property: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut cursor = 0usize;
    while let Some(relative) = input[cursor..].find(property) {
        let start = cursor + relative;
        let end = start + property.len();
        let previous_is_identifier = start > 0 && is_js_identifier_byte(bytes[start - 1]);
        let next_is_identifier = bytes
            .get(end)
            .is_some_and(|byte| is_js_identifier_byte(*byte));
        if previous_is_identifier || next_is_identifier {
            cursor = end;
            continue;
        }
        let mut index = end;
        while bytes
            .get(index)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            index += 1;
        }
        if bytes.get(index) != Some(&b':') {
            cursor = end;
            continue;
        }
        index += 1;
        while bytes
            .get(index)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            index += 1;
        }
        let delimiter = *bytes.get(index)?;
        if !matches!(delimiter, b'\'' | b'"' | b'`') {
            cursor = end;
            continue;
        }
        index += 1;
        let mut value = String::new();
        let mut escaped = false;
        while let Some(byte) = bytes.get(index).copied() {
            if escaped {
                value.push(match byte {
                    b'n' => '\n',
                    b'r' => '\r',
                    b't' => '\t',
                    other => other as char,
                });
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == delimiter {
                return Some(value);
            } else {
                value.push(byte as char);
            }
            index += 1;
        }
        return None;
    }
    None
}

fn is_js_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

fn extract_from_locator_text(text: &str, output: &mut BTreeSet<String>) {
    let normalized = text.replace('\\', "/");
    let mut cursor = 0usize;
    while let Some(relative) = normalized[cursor..].find("SKILL.md") {
        let index = cursor + relative;
        let after = index.saturating_add("SKILL.md".len());
        let before_is_component_boundary =
            index > 0 && normalized.as_bytes().get(index - 1) == Some(&b'/');
        let after_is_component_boundary = normalized.as_bytes().get(after).is_none_or(|byte| {
            !byte.is_ascii_alphanumeric() && !matches!(byte, b'_' | b'-' | b'.')
        });
        if !before_is_component_boundary || !after_is_component_boundary {
            cursor = after;
            if cursor >= normalized.len() {
                break;
            }
            continue;
        }
        let before = normalized[..index].trim_end_matches('/');
        let components: Vec<_> = before
            .split('/')
            .filter(|component| !component.is_empty())
            .collect();
        if let Some(skill_name) = components.last().copied() {
            let ancestors = &components[..components.len() - 1];
            if valid_skill_name(skill_name)
                && let Some(skills_index) = ancestors
                    .iter()
                    .rposition(|component| *component == "skills")
            {
                let prefix = &ancestors[..skills_index];
                let key = prefix
                    .len()
                    .checked_sub(4)
                    .and_then(|index| {
                        (prefix.get(index) == Some(&"plugins")
                            && prefix.get(index + 1) == Some(&"cache"))
                        .then(|| (index, prefix.get(index + 2), prefix.get(index + 3)))
                    })
                    .and_then(|(_, plugin, version)| match (plugin, version) {
                        (Some(plugin), Some(version))
                            if valid_namespace_component(plugin)
                                && valid_namespace_component(version) =>
                        {
                            Some(format!("{plugin}:{skill_name}"))
                        }
                        _ => None,
                    })
                    .unwrap_or_else(|| skill_name.to_owned());
                output.insert(key);
            }
        }
        cursor = after;
        if cursor >= normalized.len() {
            break;
        }
    }
}

fn valid_namespace_component(value: &str) -> bool {
    !value.is_empty() && !value.chars().any(char::is_control)
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
    fn t_s07_001_function_exec_command_reads_json_arguments_and_deduplicates() {
        let parser = SkillUsageParser;
        let payload = json!({
            "type": "function_call",
            "name": "exec_command",
            "arguments": json!({
                "cmd": "cat /Users/me/.codex/skills/frontend-skill/SKILL.md && sed -n '1,40p' C:\\Users\\me\\.codex\\skills\\diagnosing-bugs\\SKILL.md && cat /Users/me/.codex/skills/frontend-skill/SKILL.md"
            }).to_string(),
        });
        let parsed = parser.parse_line(&response(&payload.to_string())).unwrap();
        assert_eq!(
            parsed.skill_names,
            vec!["diagnosing-bugs", "frontend-skill"]
        );
    }

    #[test]
    fn t_s07_002_custom_exec_reads_only_actual_tools_exec_command_js() {
        let parser = SkillUsageParser;
        let payload = json!({
            "type": "custom_tool_call",
            "name": "exec",
            "input": r#"const result = await tools.exec_command({cmd:"sed -n '1,120p' /Users/me/.codex/plugins/cache/browser/26.814.41407/skills/control-in-app-browser/SKILL.md"});"#,
        });
        let parsed = parser.parse_line(&response(&payload.to_string())).unwrap();
        assert_eq!(parsed.skill_names, vec!["browser:control-in-app-browser"]);
    }

    #[test]
    fn t_s07_003_plugin_locators_use_stable_plugin_namespace_keys() {
        let parser = SkillUsageParser;
        let payload = json!({
            "type": "function_call",
            "name": "exec_command",
            "arguments": json!({
                "cmd": "cat /Users/me/.codex/plugins/cache/github/0.1.10/skills/github/SKILL.md && cat /Users/me/.codex/plugins/cache/computer-use/1.0.1000761/skills/computer-use/SKILL.md && cat /Users/me/.codex/skills/diagnosing-bugs/SKILL.md"
            }).to_string(),
        });
        let parsed = parser.parse_line(&response(&payload.to_string())).unwrap();
        assert_eq!(
            parsed.skill_names,
            vec![
                "computer-use:computer-use",
                "diagnosing-bugs",
                "github:github"
            ]
        );
    }

    #[test]
    fn t_s07_004_apply_patch_source_and_unrelated_call_text_are_ignored() {
        let parser = SkillUsageParser;
        let apply_patch = json!({
            "type": "custom_tool_call",
            "name": "apply_patch",
            "input": "*** Begin Patch\n*** Update File: src/lib.rs\n+const path = \"/tmp/skills/foo/SKILL.md\";\n*** End Patch",
        });
        assert!(
            parser
                .parse_line(&response(&apply_patch.to_string()))
                .is_none()
        );

        let source_text = json!({
            "type": "custom_tool_call",
            "name": "exec",
            "input": "const note = \"source /x/skills/source/SKILL.md\";",
            "source": "/x/skills/source-field/SKILL.md",
            "log": "/x/skills/log-field/SKILL.md",
            "note": "/x/skills/note-field/SKILL.md",
        });
        assert!(
            parser
                .parse_line(&response(&source_text.to_string()))
                .is_none()
        );

        let future_call = json!({
            "type": "some_future_call",
            "input": "/x/skills/future-action/SKILL.md",
            "action": {"cmd": "cat /x/skills/future-action/SKILL.md"},
        });
        assert!(
            parser
                .parse_line(&response(&future_call.to_string()))
                .is_none()
        );
    }

    #[test]
    fn t_s07_005_invalid_locator_shapes_are_rejected() {
        let parser = SkillUsageParser;
        let payload = json!({
            "type": "function_call",
            "name": "exec_command",
            "arguments": json!({
                "cmd": "cat /foo/bar/SKILL.md && cat /tmp/my-skills-backup/foo/SKILL.md && cat /tmp/skills-old/foo/SKILL.md && printf 'const r = \"SKILL.md\"'"
            }).to_string(),
        });
        assert!(parser.parse_line(&response(&payload.to_string())).is_none());
    }

    #[test]
    fn t_s07_006_message_and_missing_timestamp_are_ignored() {
        let parser = SkillUsageParser;
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
                r#"{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"cat /x/skills/foo/SKILL.md\"}"}}"#,
            ))
            .is_none());
    }
}
