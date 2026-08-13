use std::time::Duration;

use axum::http::{Method, StatusCode};
use futures_util::StreamExt;

use crate::domain::{ScanCompletedEvent, ScanStartEvent, ScanTrigger};

use super::support::ApiFixture;

#[cfg(target_os = "linux")]
fn linux_status_kib(name: &str) -> Option<u64> {
    std::fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key == name).then(|| value.split_whitespace().next()?.parse().ok())?
        })
}

#[cfg(not(target_os = "linux"))]
fn linux_status_kib(_name: &str) -> Option<u64> {
    None
}

#[ignore = "Spec05 P2 SSE pressure gate; run explicitly with --ignored"]
#[tokio::test]
async fn t_s05_016_sse_slow_receiver_coalesces_and_disconnects_stay_bounded() {
    let fixture = ApiFixture::new("sse-p2");
    let response = fixture.call(Method::GET, "/api/events", &[]).await;
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = response.into_body().into_data_stream();
    let initial = tokio::time::timeout(Duration::from_secs(1), body.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&initial).contains("event: revision"));

    let before = fixture.ledger.current_revision();
    for index in 0..64_u64 {
        let scan_id = format!("00000000-0000-4000-8000-{index:012x}");
        fixture
            .ledger
            .mark_scan_started(
                ScanStartEvent::new(&scan_id, ScanTrigger::Manual, 1_000 + index as i64 * 2)
                    .unwrap(),
            )
            .unwrap();
        fixture
            .ledger
            .mark_scan_completed(
                ScanCompletedEvent::new(&scan_id, 1_001 + index as i64 * 2).unwrap(),
            )
            .unwrap();
    }
    let latest = fixture.ledger.current_revision();
    assert_eq!(latest.status_revision, before.status_revision + 128);

    // The receiver was intentionally not polled during all 128 commits. watch
    // must collapse them to one latest tuple rather than queue every revision.
    let next = tokio::time::timeout(Duration::from_secs(1), body.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let text = String::from_utf8_lossy(&next);
    assert!(text.contains(&format!("\"status_revision\":{}", latest.status_revision)));
    drop(body);

    // Repeated connect/drop cycles exercise receiver lifecycle. On Linux, use
    // real process metrics as a bounded resource assertion rather than a
    // vacuous elapsed-time check.
    for _ in 0..32 {
        drop(fixture.call(Method::GET, "/api/events", &[]).await);
    }
    let rss_before = linux_status_kib("VmRSS");
    let threads_before = linux_status_kib("Threads");
    for _ in 0..512 {
        let response = fixture.call(Method::GET, "/api/events", &[]).await;
        assert_eq!(response.status(), StatusCode::OK);
        drop(response);
    }
    if let (Some(before), Some(after)) = (rss_before, linux_status_kib("VmRSS")) {
        assert!(
            after.saturating_sub(before) <= 16 * 1024,
            "512 disconnected SSE responses grew RSS by more than 16 MiB: before={before}KiB after={after}KiB"
        );
    }
    if let (Some(before), Some(after)) = (threads_before, linux_status_kib("Threads")) {
        assert!(
            after <= before + 2,
            "SSE disconnect cycles leaked OS threads: before={before} after={after}"
        );
    }

    fixture.scanner.shutdown().unwrap();
}
