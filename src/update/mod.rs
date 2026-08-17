//! Asynchronous update checks isolated from the application data services.
//!
//! The service owns only in-memory state and one single-flight gate.  It does
//! not hold a Ledger or Scanner lock while making the outbound request.

use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use futures_util::{FutureExt, future::BoxFuture};
use semver::Version;
use tokio::{
    sync::{Mutex, Notify},
    task::JoinHandle,
    time::{self, MissedTickBehavior},
};

mod github;
mod state;

pub use github::GithubReleaseAdapter;
pub use state::{CURRENT_VERSION, UpdateFailureKind, UpdateSnapshot};

/// Automatic checks are spaced by exactly four hours after the startup check.
pub const AUTO_CHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);

/// A validated stable release returned by a release provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReleaseInfo {
    version: Version,
    release_url: String,
}

impl ReleaseInfo {
    /// Construct a release using the fixed repository's canonical `v` tag.
    /// Prerelease versions are not accepted as stable releases.
    pub fn stable(version: Version) -> Result<Self, UpdateFailureKind> {
        let tag = format!("v{version}");
        let (version, release_url) = github::release_url_for_tag(&tag)?;
        Ok(Self {
            version,
            release_url,
        })
    }

    pub fn version(&self) -> &Version {
        &self.version
    }

    pub fn release_url(&self) -> &str {
        &self.release_url
    }

    fn from_tag(tag: &str) -> Result<Self, UpdateFailureKind> {
        let (version, release_url) = github::release_url_for_tag(tag)?;
        Ok(Self {
            version,
            release_url,
        })
    }
}

/// Injectable latest-release seam.  The production implementation is
/// [`GithubReleaseAdapter`]; tests use a deterministic in-memory provider.
pub trait ReleaseProvider: Send + Sync + 'static {
    fn fetch_latest(&self) -> BoxFuture<'_, Result<ReleaseInfo, UpdateFailureKind>>;
}

struct UnavailableProvider;

impl ReleaseProvider for UnavailableProvider {
    fn fetch_latest(&self) -> BoxFuture<'_, Result<ReleaseInfo, UpdateFailureKind>> {
        futures_util::future::ready(Err(UpdateFailureKind::Client)).boxed()
    }
}

pub type UpdateClock = Arc<dyn Fn() -> i64 + Send + Sync + 'static>;
pub type CheckResult = Result<UpdateSnapshot, UpdateFailureKind>;

struct CheckFlight {
    result: Mutex<Option<CheckResult>>,
    completed: Notify,
}

impl CheckFlight {
    fn new() -> Self {
        Self {
            result: Mutex::new(None),
            completed: Notify::new(),
        }
    }

    async fn finish(&self, result: CheckResult) {
        *self.result.lock().await = Some(result);
        self.completed.notify_waiters();
    }

    async fn wait(&self) -> CheckResult {
        loop {
            if let Some(result) = self.result.lock().await.clone() {
                return result;
            }
            self.completed.notified().await;
        }
    }
}

/// In-memory asynchronous update service.
pub struct UpdateService {
    adapter: Arc<dyn ReleaseProvider>,
    state: state::UpdateState,
    flight: Mutex<Option<Arc<CheckFlight>>>,
    clock: UpdateClock,
}

impl UpdateService {
    pub fn new(adapter: Arc<dyn ReleaseProvider>) -> Self {
        Self::new_with_clock(adapter, Arc::new(now_ms))
    }

    /// Build the production service.  Failure to construct the HTTP client is
    /// returned to the caller so startup can continue without updates.
    pub fn new_github() -> Result<Arc<Self>, reqwest::Error> {
        Ok(Arc::new(Self::new(Arc::new(GithubReleaseAdapter::new()?))))
    }

    /// Build a service that keeps update checks unavailable while leaving the
    /// rest of the application usable.  This is used when the production HTTP
    /// adapter cannot be constructed during startup.
    pub fn unavailable() -> Arc<Self> {
        Arc::new(Self::new(Arc::new(UnavailableProvider)))
    }

    /// Clock injection is intentionally a small closure seam for deterministic
    /// state/timer tests; production callers should use [`Self::new`].
    pub fn new_with_clock(adapter: Arc<dyn ReleaseProvider>, clock: UpdateClock) -> Self {
        Self {
            adapter,
            state: state::UpdateState::new(),
            flight: Mutex::new(None),
            clock,
        }
    }

    pub async fn status(&self) -> UpdateSnapshot {
        self.state.snapshot().await
    }

    /// Run one check, sharing an in-flight request with concurrent callers.
    pub async fn check_now(&self) -> CheckResult {
        let (flight, owner) = {
            let mut current = self.flight.lock().await;
            if let Some(flight) = current.as_ref() {
                (Arc::clone(flight), false)
            } else {
                let flight = Arc::new(CheckFlight::new());
                *current = Some(Arc::clone(&flight));
                (flight, true)
            }
        };

        if !owner {
            return flight.wait().await;
        }

        let result = self.perform_check().await;
        flight.finish(result.clone()).await;
        let mut current = self.flight.lock().await;
        if current
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, &flight))
        {
            *current = None;
        }
        result
    }

    async fn perform_check(&self) -> CheckResult {
        self.state.begin_attempt((self.clock)()).await;
        match self.adapter.fetch_latest().await {
            Ok(release) => {
                let snapshot = self
                    .state
                    .complete_success(
                        release.version().clone(),
                        release.release_url().to_owned(),
                        (self.clock)(),
                    )
                    .await;
                Ok(snapshot)
            }
            Err(failure) => {
                self.state.complete_failure(failure).await;
                Err(failure)
            }
        }
    }

    /// Run the startup check and then the strict four-hour timer forever.
    pub async fn run_background(&self) {
        let _ = self.check_now().await;
        let start = time::Instant::now() + AUTO_CHECK_INTERVAL;
        let mut interval = time::interval_at(start, AUTO_CHECK_INTERVAL);
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            let _ = self.check_now().await;
        }
    }

    pub fn spawn_background(self: Arc<Self>) -> JoinHandle<()> {
        tokio::spawn(async move { self.run_background().await })
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use futures_util::FutureExt;
    use tokio::sync::Notify;

    use super::*;

    struct FakeProvider {
        calls: AtomicUsize,
        next: Mutex<Result<ReleaseInfo, UpdateFailureKind>>,
        entered: Option<Arc<Notify>>,
        release: Option<Arc<Notify>>,
    }

    impl FakeProvider {
        fn success(version: Version) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                next: Mutex::new(ReleaseInfo::stable(version)),
                entered: None,
                release: None,
            }
        }

        fn blocked(version: Version, entered: Arc<Notify>, release: Arc<Notify>) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                next: Mutex::new(ReleaseInfo::stable(version)),
                entered: Some(entered),
                release: Some(release),
            }
        }
    }

    impl ReleaseProvider for FakeProvider {
        fn fetch_latest(&self) -> BoxFuture<'_, Result<ReleaseInfo, UpdateFailureKind>> {
            async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                if let Some(entered) = &self.entered {
                    entered.notify_waiters();
                    if let Some(release) = &self.release {
                        release.notified().await;
                    }
                }
                self.next.lock().await.clone()
            }
            .boxed()
        }
    }

    fn fixed_clock() -> UpdateClock {
        Arc::new(|| 1_000)
    }

    #[tokio::test]
    async fn t_dist_007_newer_equal_and_older_matrix() {
        let current = Version::parse(CURRENT_VERSION).unwrap();
        let mut newer = current.clone();
        newer.patch = newer.patch.checked_add(1).unwrap();
        for (latest, expected_available) in [
            (newer, true),
            (current, false),
            (Version::new(0, 0, 0), false),
        ] {
            let service = UpdateService::new_with_clock(
                Arc::new(FakeProvider::success(latest.clone())),
                fixed_clock(),
            );
            let snapshot = service.check_now().await.unwrap();
            assert_eq!(snapshot.update_available, expected_available);
            assert_eq!(snapshot.latest_version, Some(latest));
            assert_eq!(snapshot.last_successful_checked_at_ms, Some(1_000));
            assert!(!snapshot.checking);
        }
    }

    #[tokio::test]
    async fn t_dist_007_failure_matrix_preserves_successful_newer_release() {
        let mut newer = Version::parse(CURRENT_VERSION).unwrap();
        newer.patch = newer.patch.checked_add(1).unwrap();
        let provider = Arc::new(FakeProvider::success(newer.clone()));
        let service = UpdateService::new_with_clock(
            Arc::clone(&provider) as Arc<dyn ReleaseProvider>,
            fixed_clock(),
        );
        service.check_now().await.unwrap();

        for failure in [
            UpdateFailureKind::InvalidTag,
            UpdateFailureKind::Timeout,
            UpdateFailureKind::Network,
            UpdateFailureKind::HttpStatus(503),
            UpdateFailureKind::InvalidJson,
        ] {
            *provider.next.lock().await = Err(failure);
            assert_eq!(service.check_now().await.unwrap_err(), failure);
            let snapshot = service.status().await;
            assert_eq!(snapshot.last_attempt_failure, Some(failure));
            assert_eq!(snapshot.latest_version, Some(newer.clone()));
            assert!(snapshot.update_available);
            assert!(!snapshot.checking);
        }

        assert_eq!(provider.calls.load(Ordering::SeqCst), 6);
    }

    #[tokio::test]
    async fn t_dist_007_single_flight_shares_one_provider_call() {
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let provider = Arc::new(FakeProvider::blocked(
            Version::new(0, 1, 1),
            Arc::clone(&entered),
            Arc::clone(&release),
        ));
        let service = Arc::new(UpdateService::new_with_clock(
            Arc::clone(&provider) as Arc<dyn ReleaseProvider>,
            fixed_clock(),
        ));

        let first = {
            let service = Arc::clone(&service);
            tokio::spawn(async move { service.check_now().await })
        };
        entered.notified().await;
        let second = {
            let service = Arc::clone(&service);
            tokio::spawn(async move { service.check_now().await })
        };
        tokio::task::yield_now().await;
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        release.notify_waiters();
        assert!(first.await.unwrap().is_ok());
        assert!(second.await.unwrap().is_ok());
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn t_dist_007_background_runs_immediately_then_every_four_hours() {
        let provider = Arc::new(FakeProvider::success(Version::new(0, 1, 1)));
        let service = Arc::new(UpdateService::new(
            Arc::clone(&provider) as Arc<dyn ReleaseProvider>
        ));
        let task = Arc::clone(&service).spawn_background();
        tokio::task::yield_now().await;
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);

        time::advance(AUTO_CHECK_INTERVAL - Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        time::advance(Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert_eq!(provider.calls.load(Ordering::SeqCst), 2);
        task.abort();
        let _ = task.await;
    }

    #[tokio::test]
    async fn t_dist_007_slow_provider_does_not_block_status_reads() {
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let provider = Arc::new(FakeProvider::blocked(
            Version::new(0, 1, 1),
            Arc::clone(&entered),
            Arc::clone(&release),
        ));
        let service = Arc::new(UpdateService::new(
            Arc::clone(&provider) as Arc<dyn ReleaseProvider>
        ));
        let check = {
            let service = Arc::clone(&service);
            tokio::spawn(async move { service.check_now().await })
        };
        entered.notified().await;
        assert!(service.status().await.checking);
        release.notify_waiters();
        check.await.unwrap().unwrap();
    }
}
