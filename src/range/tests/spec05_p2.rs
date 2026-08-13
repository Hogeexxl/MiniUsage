use chrono::{DateTime, NaiveDate};

use super::*;

fn utc_ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_millis()
}

#[test]
fn t_s05_002_skipped_date_and_rare_tzdb_boundaries_are_deterministic() {
    // Samoa skipped 2011-12-30 entirely. The skipped date's midnight and
    // the following date's midnight resolve to the same first valid instant.
    let apia = TzifZone::load("Pacific/Apia").unwrap();
    let skipped = NaiveDate::from_ymd_opt(2011, 12, 30).unwrap();
    let following = NaiveDate::from_ymd_opt(2011, 12, 31).unwrap();
    assert_eq!(
        apia.local_midnight_to_utc_ms(skipped).unwrap(),
        utc_ms("2011-12-30T10:00:00Z")
    );
    assert_eq!(
        apia.local_midnight_to_utc_ms(skipped).unwrap(),
        apia.local_midnight_to_utc_ms(following).unwrap()
    );

    // Cuba's 2026 fall-back repeats local 00:00; the earlier instant wins.
    let havana = TzifZone::load("America/Havana").unwrap();
    assert_eq!(
        havana
            .local_midnight_to_utc_ms(NaiveDate::from_ymd_opt(2026, 11, 1).unwrap())
            .unwrap(),
        utc_ms("2026-11-01T04:00:00Z")
    );
    // Its spring transition skips local 00:00; the first valid instant is 01:00.
    assert_eq!(
        havana
            .local_midnight_to_utc_ms(NaiveDate::from_ymd_opt(2026, 3, 8).unwrap())
            .unwrap(),
        utc_ms("2026-03-08T05:00:00Z")
    );

    // Non-hour base offsets and half-hour DST changes must not be rounded.
    let lord_howe = TzifZone::load("Australia/Lord_Howe").unwrap();
    assert_eq!(
        lord_howe
            .local_midnight_to_utc_ms(NaiveDate::from_ymd_opt(2026, 10, 4).unwrap())
            .unwrap(),
        utc_ms("2026-10-03T13:30:00Z")
    );
    assert_eq!(
        lord_howe
            .local_midnight_to_utc_ms(NaiveDate::from_ymd_opt(2026, 10, 5).unwrap())
            .unwrap(),
        utc_ms("2026-10-04T13:00:00Z")
    );

    let chatham = TzifZone::load("Pacific/Chatham").unwrap();
    assert_eq!(
        chatham
            .local_midnight_to_utc_ms(NaiveDate::from_ymd_opt(2026, 9, 27).unwrap())
            .unwrap(),
        utc_ms("2026-09-26T11:15:00Z")
    );
    assert_eq!(
        chatham
            .local_midnight_to_utc_ms(NaiveDate::from_ymd_opt(2026, 9, 28).unwrap())
            .unwrap(),
        utc_ms("2026-09-27T10:15:00Z")
    );
}
