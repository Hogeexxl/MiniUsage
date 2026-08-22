use std::sync::Arc;

#[cfg(not(feature = "embedded-frontend"))]
use std::path::PathBuf;

use mini_usage::{
    api::{AppContext, ProcessShutdown, QueryApi, listen_address},
    codex::quota::CodexQuotaService,
    launcher::{self, BindOutcome},
    platform::browser::{self, BrowserOpener, SystemBrowser},
    scanner::{CodexMetadata, ScanConfig, ScanCoordinator},
    storage::{Ledger, LedgerOptions},
    update::UpdateService,
};

#[tokio::main]
async fn main() {
    if let Err(error) = run(SystemBrowser).await {
        eprintln!("MiniUsage startup failed: {error}");
        std::process::exit(1);
    }
}

async fn run(browser_opener: impl BrowserOpener + Clone + 'static) -> Result<(), String> {
    run_with_update_factory(browser_opener, LedgerOptions::default(), || {
        UpdateService::new_github().map_err(|error| error.to_string())
    })
    .await
}

/// Run the production startup lifecycle with a small update-service factory
/// seam.  The factory is called only after the listener, Ledger, Scanner, and
/// HTTP router are ready, so a slow provider can never hold up startup.
async fn run_with_update_factory<B, F>(
    browser_opener: B,
    ledger_options: LedgerOptions,
    update_factory: F,
) -> Result<(), String>
where
    B: BrowserOpener + Clone + 'static,
    F: FnOnce() -> Result<Arc<UpdateService>, String> + Send + 'static,
{
    let browser_opener: Arc<dyn BrowserOpener> = Arc::new(browser_opener);
    let listener = match launcher::bind_or_detect_existing()
        .await
        .map_err(|error| error.to_string())?
    {
        BindOutcome::ExistingInstance => {
            println!("MiniUsage is already running at {}", browser::DASHBOARD_URL);
            if let Err(error) = browser::open_dashboard(browser_opener.as_ref()) {
                eprintln!(
                    "MiniUsage is already running, but the browser could not be opened: {error}\n"
                );
                eprintln!("Open {} manually.", browser::DASHBOARD_URL);
            }
            return Ok(());
        }
        BindOutcome::Listener(listener) => listener,
    };

    let ledger = Arc::new(
        Ledger::open(ledger_options)
            .map_err(|error| format!("could not open MiniUsage ledger: {error}"))?,
    );
    let scan_config = ScanConfig::new(ledger.codex_home().to_path_buf());
    let scanner = ScanCoordinator::start(
        scan_config,
        Arc::clone(&ledger),
        CodexMetadata::from_home(ledger.codex_home()),
    )
    .map_err(|error| format!("could not start MiniUsage scanner: {error:?}"))?;
    let codex_quota_service = match CodexQuotaService::new(ledger.codex_home()) {
        Ok(service) => service,
        Err(error) => {
            eprintln!("MiniUsage Codex quota unavailable: {error}");
            CodexQuotaService::unavailable(ledger.codex_home())
        }
    };
    let (process_shutdown, mut shutdown_requested) = ProcessShutdown::channel();
    let update_service = match update_factory() {
        Ok(service) => service,
        Err(error) => {
            eprintln!("MiniUsage update checks unavailable: {error}");
            UpdateService::unavailable()
        }
    };

    #[cfg(feature = "embedded-frontend")]
    let app = QueryApi::router_with_embedded_frontend_and_shutdown(
        AppContext {
            ledger,
            scanner,
            codex_quota_service: Arc::clone(&codex_quota_service),
            update_service: Arc::clone(&update_service),
            browser_opener: Arc::clone(&browser_opener),
        },
        process_shutdown,
    )
    .map_err(|error| format!("could not construct MiniUsage embedded router: {error}"))?;

    #[cfg(not(feature = "embedded-frontend"))]
    let app = QueryApi::router_with_shutdown(
        AppContext {
            ledger,
            scanner,
            codex_quota_service: Arc::clone(&codex_quota_service),
            update_service: Arc::clone(&update_service),
            browser_opener: Arc::clone(&browser_opener),
        },
        PathBuf::from("frontend/dist"),
        process_shutdown,
    )
    .map_err(|error| format!("could not construct MiniUsage router: {error}"))?;

    let address = listen_address();
    println!("MiniUsage is running at http://{address}");
    let mut server = Box::pin(
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_requested.wait_for(|requested| *requested).await;
            })
            .into_future(),
    );

    tokio::select! {
        result = &mut server => {
            return result.map_err(|error| format!("MiniUsage server stopped unexpectedly: {error}"));
        }
        result = launcher::wait_until_ready(address) => {
            result.map_err(|error| error.to_string())?;
        }
    }

    let codex_quota_task = codex_quota_service.spawn_background();

    if let Err(error) = browser::open_dashboard(browser_opener.as_ref()) {
        eprintln!("MiniUsage server is ready, but the browser could not be opened: {error}");
        eprintln!("Open {} manually.", browser::DASHBOARD_URL);
    }

    let update_task = update_service.spawn_background();

    let result = server
        .await
        .map_err(|error| format!("MiniUsage server stopped unexpectedly: {error}"));
    update_task.abort();
    let _ = update_task.await;
    codex_quota_task.abort();
    let _ = codex_quota_task.await;
    result
}

#[cfg(test)]
mod tests {
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::Arc,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use futures_util::{FutureExt, future::BoxFuture};
    use mini_usage::{
        api::listen_address,
        platform::browser::{BrowserError, BrowserOpener},
        update::{ReleaseInfo, ReleaseProvider, UpdateFailureKind, UpdateService},
    };
    use reqwest::StatusCode;
    use semver::Version;
    use tokio::sync::Notify;

    use super::run_with_update_factory;

    #[derive(Clone, Copy)]
    struct TestBrowser;

    impl BrowserOpener for TestBrowser {
        fn open(&self, _url: &str) -> Result<(), BrowserError> {
            Ok(())
        }
    }

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> io::Result<Self> {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "miniusage-update-startup-{}-{stamp}",
                std::process::id()
            ));
            fs::create_dir(&path)?;
            Ok(Self(path))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct HangingProvider {
        entered: Arc<Notify>,
        release: Arc<Notify>,
    }

    impl ReleaseProvider for HangingProvider {
        fn fetch_latest(&self) -> BoxFuture<'_, Result<ReleaseInfo, UpdateFailureKind>> {
            async move {
                self.entered.notify_one();
                self.release.notified().await;
                ReleaseInfo::stable(Version::new(0, 1, 1))
            }
            .boxed()
        }
    }

    #[test]
    fn server_address_is_fixed_loopback() {
        assert_eq!(listen_address().to_string(), "127.0.0.1:3210");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn t_dist_007_slow_update_provider_does_not_block_real_startup_lifecycle() {
        let root = TempRoot::new().unwrap();
        let codex_home = root.path().join("codex");
        fs::create_dir_all(codex_home.join("sessions")).unwrap();
        fs::create_dir_all(codex_home.join("archived_sessions")).unwrap();
        let ledger_options =
            mini_usage::storage::LedgerOptions::new(root.path().join("mu.sqlite3"), codex_home);

        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let provider = Arc::new(HangingProvider {
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
        });
        let update_service = Arc::new(UpdateService::new(provider));
        let startup = tokio::spawn(async move {
            run_with_update_factory(TestBrowser, ledger_options, move || {
                Ok(Arc::clone(&update_service))
            })
            .await
        });

        tokio::time::timeout(Duration::from_secs(5), entered.notified())
            .await
            .expect("startup update check did not begin");

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let health = tokio::time::timeout(
            Duration::from_secs(1),
            client.get("http://127.0.0.1:3210/api/health").send(),
        )
        .await
        .expect("health request timed out while update provider was hung")
        .unwrap();
        assert_eq!(health.status(), StatusCode::NO_CONTENT);

        let status = tokio::time::timeout(
            Duration::from_secs(1),
            client.get("http://127.0.0.1:3210/api/status").send(),
        )
        .await
        .expect("status API timed out while update provider was hung")
        .unwrap();
        assert_eq!(status.status(), StatusCode::OK);

        let refresh = tokio::time::timeout(
            Duration::from_secs(5),
            client
                .post("http://127.0.0.1:3210/api/refresh")
                .header("x-miniusage-request", "1")
                .send(),
        )
        .await
        .expect("manual refresh timed out while update provider was hung")
        .unwrap();
        assert!(matches!(
            refresh.status(),
            StatusCode::OK | StatusCode::ACCEPTED
        ));

        let stop = client
            .post("http://127.0.0.1:3210/api/service/stop")
            .header("x-miniusage-request", "1")
            .send()
            .await
            .unwrap();
        assert_eq!(stop.status(), StatusCode::OK);
        let result = tokio::time::timeout(Duration::from_secs(5), startup)
            .await
            .expect("startup task did not stop")
            .unwrap();
        assert!(result.is_ok(), "startup failed: {result:?}");
    }
}
