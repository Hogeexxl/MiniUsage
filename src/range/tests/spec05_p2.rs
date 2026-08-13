use chrono::{DateTime, NaiveDate};

use super::*;

fn utc_ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_millis()
}

fn test_zone(name: &str) -> TzifZone {
    let transition = |value: &str, offset_seconds| ZoneTransition {
        utc_seconds: DateTime::parse_from_rfc3339(value).unwrap().timestamp(),
        offset_seconds,
    };
    match name {
        "Pacific/Apia" => TzifZone {
            initial_offset: -36_000,
            transitions: vec![transition("2011-12-30T10:00:00Z", 50_400)],
            offsets: vec![-36_000, 50_400],
        },
        "America/Havana" => TzifZone {
            initial_offset: -18_000,
            transitions: vec![
                transition("2026-03-08T05:00:00Z", -14_400),
                transition("2026-11-01T05:00:00Z", -18_000),
            ],
            offsets: vec![-18_000, -14_400],
        },
        "Australia/Lord_Howe" => TzifZone {
            initial_offset: 37_800,
            transitions: vec![transition("2026-10-03T15:30:00Z", 39_600)],
            offsets: vec![37_800, 39_600],
        },
        "Pacific/Chatham" => TzifZone {
            initial_offset: 45_900,
            transitions: vec![transition("2026-09-26T14:00:00Z", 49_500)],
            offsets: vec![45_900, 49_500],
        },
        _ => panic!("unknown deterministic timezone fixture: {name}"),
    }
}

#[test]
fn t_s05_002_skipped_date_and_rare_tzdb_boundaries_are_deterministic() {
    // Inject the transition tables so this boundary matrix does not depend
    // on a host's installed tzdb or filesystem layout.
    // Samoa skipped 2011-12-30 entirely. The skipped date's midnight and
    // the following date's midnight resolve to the same first valid instant.
    let apia = test_zone("Pacific/Apia");
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
    let havana = test_zone("America/Havana");
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
    let lord_howe = test_zone("Australia/Lord_Howe");
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

    let chatham = test_zone("Pacific/Chatham");
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
