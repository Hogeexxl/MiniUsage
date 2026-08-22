use std::{
    fmt, fs, io,
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Map, Value};

const FIVE_MINUTES_SECONDS: i64 = 5 * 60;
const EIGHT_DAYS_SECONDS: i64 = 8 * 24 * 60 * 60;
const ACCOUNT_ID_CLAIM: &str = "https://api.openai.com/auth.chatgpt_account_id";

#[derive(Clone)]
pub(crate) struct Credentials {
    access_token: Option<String>,
    refresh_token: Option<String>,
    account_id: Option<String>,
    email: Option<String>,
    _openai_api_key: Option<String>,
}

impl Credentials {
    pub(crate) fn access_token(&self) -> Option<&str> {
        self.access_token.as_deref()
    }

    pub(crate) fn refresh_token(&self) -> Option<&str> {
        self.refresh_token.as_deref()
    }

    pub(crate) fn account_id(&self) -> Option<&str> {
        self.account_id.as_deref()
    }

    pub(crate) fn email(&self) -> Option<&str> {
        self.email.as_deref()
    }

    pub(crate) fn needs_refresh(&self, last_refresh: Option<&str>, now_seconds: i64) -> bool {
        let Some(access_token) = self.access_token() else {
            return false;
        };

        if let Some(expires_at) = jwt_exp(access_token) {
            return expires_at.saturating_sub(now_seconds) <= FIVE_MINUTES_SECONDS;
        }

        last_refresh
            .and_then(parse_timestamp_seconds)
            .is_some_and(|timestamp| now_seconds.saturating_sub(timestamp) > EIGHT_DAYS_SECONDS)
    }
}

pub(crate) struct AuthFile {
    path: PathBuf,
    value: Value,
    credentials: Credentials,
    last_refresh: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AuthReadError {
    Missing,
    Io,
    Invalid,
}

impl fmt::Display for AuthReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Missing => "auth.json is missing",
            Self::Io => "auth.json could not be read",
            Self::Invalid => "auth.json is invalid",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AuthWriteError {
    Io,
    Invalid,
}

impl fmt::Display for AuthWriteError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Io => "auth.json could not be written",
            Self::Invalid => "auth.json token store is invalid",
        })
    }
}

impl AuthFile {
    pub(crate) fn read(path: impl AsRef<Path>) -> Result<Self, AuthReadError> {
        let path = path.as_ref().to_path_buf();
        let text = fs::read_to_string(&path).map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => AuthReadError::Missing,
            _ => AuthReadError::Io,
        })?;
        let value = serde_json::from_str::<Value>(&text).map_err(|_| AuthReadError::Invalid)?;
        if !value.is_object() {
            return Err(AuthReadError::Invalid);
        }
        Ok(Self::from_value(path, value))
    }

    fn from_value(path: PathBuf, value: Value) -> Self {
        let (credentials, last_refresh) = extract_credentials(&value);
        Self {
            path,
            value,
            credentials,
            last_refresh,
        }
    }

    pub(crate) fn credentials(&self) -> &Credentials {
        &self.credentials
    }

    pub(crate) fn last_refresh(&self) -> Option<&str> {
        self.last_refresh.as_deref()
    }

    pub(crate) fn apply_refresh(
        &mut self,
        access_token: String,
        refresh_token: Option<String>,
        id_token: Option<String>,
        refreshed_at: String,
    ) -> Result<(), AuthWriteError> {
        if access_token.is_empty() {
            return Err(AuthWriteError::Invalid);
        }

        let root = self.value.as_object_mut().ok_or(AuthWriteError::Invalid)?;
        let tokens = root
            .entry("tokens")
            .or_insert_with(|| Value::Object(Map::new()));
        let tokens = tokens.as_object_mut().ok_or(AuthWriteError::Invalid)?;
        tokens.insert("access_token".to_owned(), Value::String(access_token));
        if let Some(refresh_token) = refresh_token.filter(|value| !value.is_empty()) {
            tokens.insert("refresh_token".to_owned(), Value::String(refresh_token));
        }
        if let Some(id_token) = id_token.filter(|value| !value.is_empty()) {
            tokens.insert("id_token".to_owned(), Value::String(id_token));
        }
        root.insert("last_refresh".to_owned(), Value::String(refreshed_at));

        let (credentials, last_refresh) = extract_credentials(&self.value);
        self.credentials = credentials;
        self.last_refresh = last_refresh;
        Ok(())
    }

    pub(crate) fn save(&self) -> Result<(), AuthWriteError> {
        let text = serde_json::to_vec_pretty(&self.value).map_err(|_| AuthWriteError::Invalid)?;
        fs::write(&self.path, text).map_err(|_| AuthWriteError::Io)
    }
}

fn extract_credentials(value: &Value) -> (Credentials, Option<String>) {
    let tokens = value.get("tokens").and_then(Value::as_object);
    let access_token = non_empty_string(tokens.and_then(|tokens| tokens.get("access_token")));
    let refresh_token = non_empty_string(tokens.and_then(|tokens| tokens.get("refresh_token")));
    let id_token = non_empty_string(tokens.and_then(|tokens| tokens.get("id_token")));
    let account_id = non_empty_string(tokens.and_then(|tokens| tokens.get("account_id")))
        .or_else(|| id_token.as_deref().and_then(jwt_account_id));
    let email = id_token.as_deref().and_then(jwt_email);
    let openai_api_key = non_empty_string(value.get("OPENAI_API_KEY"));
    let last_refresh = non_empty_string(value.get("last_refresh"));

    (
        Credentials {
            access_token,
            refresh_token,
            account_id,
            email,
            _openai_api_key: openai_api_key,
        },
        last_refresh,
    )
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn jwt_payload(token: &str) -> Option<Value> {
    let encoded = token.split('.').nth(1)?.trim_end_matches('=');
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    let payload = serde_json::from_slice::<Value>(&bytes).ok()?;
    payload.is_object().then_some(payload)
}

pub(crate) fn jwt_exp(token: &str) -> Option<i64> {
    let value = jwt_payload(token)?;
    let value = value.get("exp")?;
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|value| value as i64)
    })
}

fn jwt_email(token: &str) -> Option<String> {
    jwt_payload(token)?
        .get("email")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn jwt_account_id(token: &str) -> Option<String> {
    jwt_payload(token)?
        .get(ACCOUNT_ID_CLAIM)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn parse_timestamp_seconds(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.timestamp())
}

pub(crate) fn refreshed_timestamp() -> String {
    DateTime::<Utc>::from(std::time::SystemTime::now()).to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use serde_json::json;

    fn token(payload: Value) -> String {
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap());
        format!("header.{encoded}.signature")
    }

    #[test]
    fn jwt_claims_and_refresh_window_are_read_without_signature_verification() {
        let access = token(json!({"exp": 1_000}));
        let id = token(json!({
            "email": "hoge@example.com",
            "https://api.openai.com/auth.chatgpt_account_id": "acct"
        }));
        let value = json!({
            "tokens": {
                "access_token": access,
                "refresh_token": "refresh",
                "id_token": id
            },
            "last_refresh": "1970-01-01T00:00:00Z"
        });
        let file = AuthFile::from_value(PathBuf::from("auth.json"), value);
        assert_eq!(file.credentials().email(), Some("hoge@example.com"));
        assert_eq!(file.credentials().account_id(), Some("acct"));
        assert!(file.credentials().needs_refresh(file.last_refresh(), 1_000));
    }

    #[test]
    fn missing_exp_uses_eight_day_fallback_and_no_timestamp_does_not_refresh() {
        let access = token(json!({"sub": "account"}));
        let value = json!({"tokens": {"access_token": access}});
        let file = AuthFile::from_value(PathBuf::from("auth.json"), value);
        assert!(
            !file
                .credentials()
                .needs_refresh(None, EIGHT_DAYS_SECONDS + 1)
        );

        let value = json!({
            "tokens": {"access_token": token(json!({"sub": "account"}))},
            "last_refresh": "1970-01-01T00:00:00Z"
        });
        let file = AuthFile::from_value(PathBuf::from("auth.json"), value);
        assert!(
            file.credentials()
                .needs_refresh(file.last_refresh(), EIGHT_DAYS_SECONDS + 1)
        );
    }
}
