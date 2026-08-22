use axum::http::HeaderMap;
use serde_json::{Map, Value};
use std::fmt;

const SESSION_WINDOW_SECONDS: u64 = 18_000;
const WEEKLY_WINDOW_SECONDS: u64 = 604_800;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct CodexWeeklyQuota {
    pub used_percent: f64,
    pub remaining_percent: f64,
    pub limit_window_seconds: u64,
    pub reset_at_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MappedUsage {
    pub weekly: CodexWeeklyQuota,
    pub plan_type: Option<String>,
    pub reset_credits_available: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MapperError;

impl fmt::Display for MapperError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Codex quota payload is invalid")
    }
}

#[derive(Clone, Copy)]
enum WindowPosition {
    Primary,
    Secondary,
}

impl WindowPosition {
    fn header_name(self) -> &'static str {
        match self {
            Self::Primary => "x-codex-primary-used-percent",
            Self::Secondary => "x-codex-secondary-used-percent",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WindowKind {
    Session,
    Weekly,
}

struct Window<'a> {
    body: &'a Map<String, Value>,
    position: WindowPosition,
    kind: WindowKind,
}

pub(crate) fn map_usage(
    body: &Value,
    headers: &HeaderMap,
    now_ms: i64,
) -> Result<MappedUsage, MapperError> {
    let root = body.as_object().ok_or(MapperError)?;
    let rate_limit = root
        .get("rate_limit")
        .and_then(Value::as_object)
        .ok_or(MapperError)?;

    let primary = window(rate_limit.get("primary_window"), WindowPosition::Primary);
    let secondary = window(
        rate_limit.get("secondary_window"),
        WindowPosition::Secondary,
    );
    let weekly = [primary, secondary]
        .into_iter()
        .flatten()
        .find(|window| window.kind == WindowKind::Weekly)
        .ok_or(MapperError)?;

    let used_percent = used_percent(weekly.body, weekly.position, headers)?;
    let reset_at_ms = reset_at_ms(weekly.body, now_ms)?;
    let plan_type = match root.get("plan_type") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(_) => return Err(MapperError),
    };
    let reset_credits_available = root
        .get("rate_limit_reset_credits")
        .and_then(Value::as_object)
        .and_then(|credits| credits.get("available_count"))
        .and_then(reset_credit_count);

    Ok(MappedUsage {
        weekly: CodexWeeklyQuota {
            used_percent,
            remaining_percent: 100.0 - used_percent,
            limit_window_seconds: WEEKLY_WINDOW_SECONDS,
            reset_at_ms,
        },
        plan_type,
        reset_credits_available,
    })
}

fn window<'a>(value: Option<&'a Value>, position: WindowPosition) -> Option<Window<'a>> {
    let body = value?.as_object()?;
    let duration = body.get("limit_window_seconds").and_then(Value::as_u64);
    let kind = match duration {
        Some(SESSION_WINDOW_SECONDS) => WindowKind::Session,
        Some(WEEKLY_WINDOW_SECONDS) => WindowKind::Weekly,
        _ => match position {
            WindowPosition::Primary => WindowKind::Session,
            WindowPosition::Secondary => WindowKind::Weekly,
        },
    };
    Some(Window {
        body,
        position,
        kind,
    })
}

fn used_percent(
    body: &Map<String, Value>,
    position: WindowPosition,
    headers: &HeaderMap,
) -> Result<f64, MapperError> {
    let value = match body.get("used_percent") {
        None | Some(Value::Null) => headers
            .get(position.header_name())
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<f64>().ok())
            .ok_or(MapperError)?,
        Some(value) => value.as_f64().ok_or(MapperError)?,
    };
    if value.is_finite() && (0.0..=100.0).contains(&value) {
        Ok(value)
    } else {
        Err(MapperError)
    }
}

fn reset_at_ms(body: &Map<String, Value>, now_ms: i64) -> Result<Option<i64>, MapperError> {
    if let Some(value) = body.get("reset_at").filter(|value| !value.is_null()) {
        let seconds = value.as_f64().ok_or(MapperError)?;
        return seconds_to_ms(seconds);
    }

    if let Some(value) = body
        .get("reset_after_seconds")
        .filter(|value| !value.is_null())
    {
        let seconds = value.as_f64().ok_or(MapperError)?;
        if !seconds.is_finite() {
            return Err(MapperError);
        }
        let milliseconds = seconds * 1_000.0;
        if !milliseconds.is_finite()
            || milliseconds < i64::MIN as f64
            || milliseconds > i64::MAX as f64
        {
            return Err(MapperError);
        }
        let result = (now_ms as f64) + milliseconds;
        if !result.is_finite() || result < i64::MIN as f64 || result > i64::MAX as f64 {
            return Err(MapperError);
        }
        return Ok(Some(result as i64));
    }

    Ok(None)
}

fn seconds_to_ms(seconds: f64) -> Result<Option<i64>, MapperError> {
    if !seconds.is_finite() {
        return Err(MapperError);
    }
    let milliseconds = seconds * 1_000.0;
    if !milliseconds.is_finite() || milliseconds < i64::MIN as f64 || milliseconds > i64::MAX as f64
    {
        return Err(MapperError);
    }
    Ok(Some(milliseconds as i64))
}

fn reset_credit_count(value: &Value) -> Option<i64> {
    if let Some(value) = value.as_i64() {
        return (value >= 0).then_some(value);
    }
    let value = value.as_f64()?;
    if !value.is_finite() || value < 0.0 || value >= i64::MAX as f64 {
        return None;
    }
    Some(value.floor() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;
    use serde_json::json;

    #[test]
    fn t_q_001_weekly_mapper_preserves_duration_reset_plan_and_credits() {
        let body = json!({
            "plan_type": "prolite",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 12,
                    "limit_window_seconds": SESSION_WINDOW_SECONDS,
                    "reset_at": 1_786_508_580
                },
                "secondary_window": {
                    "used_percent": 55,
                    "limit_window_seconds": WEEKLY_WINDOW_SECONDS,
                    "reset_at": 1_786_508_580
                }
            },
            "rate_limit_reset_credits": {"available_count": 2}
        });
        let mapped = map_usage(&body, &HeaderMap::new(), 1_700_000_000_000).unwrap();
        assert_eq!(mapped.weekly.limit_window_seconds, WEEKLY_WINDOW_SECONDS);
        assert_eq!(mapped.weekly.used_percent, 55.0);
        assert_eq!(mapped.weekly.remaining_percent, 45.0);
        assert_eq!(mapped.weekly.reset_at_ms, Some(1_786_508_580_000));
        assert_eq!(mapped.plan_type.as_deref(), Some("prolite"));
        assert_eq!(mapped.reset_credits_available, Some(2));
    }

    #[test]
    fn t_q_002_primary_weekly_uses_reset_after_fallback() {
        let body = json!({
            "rate_limit": {
                "primary_window": {
                    "limit_window_seconds": WEEKLY_WINDOW_SECONDS,
                    "reset_after_seconds": 120
                }
            }
        });
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-codex-primary-used-percent",
            HeaderValue::from_static("55.5"),
        );
        let mapped = map_usage(&body, &headers, 1_700_000_000_000).unwrap();
        assert_eq!(mapped.weekly.used_percent, 55.5);
        assert_eq!(mapped.weekly.reset_at_ms, Some(1_700_000_120_000));
    }

    #[test]
    fn invalid_percent_is_rejected_instead_of_clamped() {
        let body = json!({
            "rate_limit": {
                "primary_window": {
                    "limit_window_seconds": WEEKLY_WINDOW_SECONDS,
                    "used_percent": 101
                }
            }
        });
        assert_eq!(
            map_usage(&body, &HeaderMap::new(), 0).unwrap_err(),
            MapperError
        );
    }
}
