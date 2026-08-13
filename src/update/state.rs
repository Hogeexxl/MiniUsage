//! In-memory update state and the failure categories used by the checker.

use std::sync::Arc;

use semver::Version;
use tokio::sync::Mutex;

/// The version of the running binary.  Release checks must not use the
/// frontend package version or a value supplied by a caller.
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// A privacy-safe description of why a release check failed.
///
/// The service deliberately keeps this as a small category instead of
/// retaining a reqwest error (which may contain URLs or platform details).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateFailureKind {
    Client,
    Timeout,
    Network,
    HttpStatus(u16),
    InvalidJson,
    InvalidRelease,
    InvalidTag,
}

/// A point-in-time view of the update service.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateSnapshot {
    pub current_version: Version,
    pub latest_version: Option<Version>,
    pub update_available: bool,
    pub release_url: Option<String>,
    pub last_successful_checked_at_ms: Option<i64>,
    pub last_attempted_at_ms: Option<i64>,
    pub checking: bool,
    pub last_attempt_failure: Option<UpdateFailureKind>,
}

impl UpdateSnapshot {
    pub(crate) fn new() -> Self {
        Self {
            current_version: Version::parse(CURRENT_VERSION)
                .expect("CARGO_PKG_VERSION must be valid semver"),
            latest_version: None,
            update_available: false,
            release_url: None,
            last_successful_checked_at_ms: None,
            last_attempted_at_ms: None,
            checking: false,
            last_attempt_failure: None,
        }
    }
}

/// Serialized mutation of the in-memory status.  It is intentionally
/// independent of Ledger and Scanner locks.
#[derive(Clone)]
pub(crate) struct UpdateState {
    snapshot: Arc<Mutex<UpdateSnapshot>>,
}

impl UpdateState {
    pub(crate) fn new() -> Self {
        Self {
            snapshot: Arc::new(Mutex::new(UpdateSnapshot::new())),
        }
    }

    pub(crate) async fn snapshot(&self) -> UpdateSnapshot {
        self.snapshot.lock().await.clone()
    }

    pub(crate) async fn begin_attempt(&self, attempted_at_ms: i64) {
        let mut snapshot = self.snapshot.lock().await;
        snapshot.last_attempted_at_ms = Some(attempted_at_ms);
        snapshot.checking = true;
        snapshot.last_attempt_failure = None;
    }

    pub(crate) async fn complete_success(
        &self,
        latest_version: Version,
        release_url: String,
        checked_at_ms: i64,
    ) -> UpdateSnapshot {
        let mut snapshot = self.snapshot.lock().await;
        snapshot.latest_version = Some(latest_version.clone());
        snapshot.update_available = latest_version > snapshot.current_version;
        snapshot.release_url = Some(release_url);
        snapshot.last_successful_checked_at_ms = Some(checked_at_ms);
        snapshot.checking = false;
        snapshot.last_attempt_failure = None;
        snapshot.clone()
    }

    pub(crate) async fn complete_failure(&self, failure: UpdateFailureKind) -> UpdateSnapshot {
        let mut snapshot = self.snapshot.lock().await;
        snapshot.checking = false;
        snapshot.last_attempt_failure = Some(failure);
        // A failed attempt must not clear the last known successful release.
        snapshot.clone()
    }
}
