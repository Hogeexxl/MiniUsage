//! Local civil-time range resolution for Spec 05.
//!
//! Named ranges are resolved from one frozen current instant and one system
//! IANA time-zone name. DST overlap uses the earlier instant; gaps use the
//! first valid instant after the gap.

use std::{
    collections::BTreeSet,
    env, fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, Datelike, Days, NaiveDate};

use crate::{api::query::ApiError, usage::aggregate::TimeRange};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RangeKey {
    Today,
    Yesterday,
    Week,
    Month,
    Year,
}

impl RangeKey {
    pub fn parse(value: Option<&str>) -> Result<Self, ApiError> {
        match value {
            Some("today") => Ok(Self::Today),
            Some("yesterday") => Ok(Self::Yesterday),
            Some("week") => Ok(Self::Week),
            Some("month") => Ok(Self::Month),
            Some("year") => Ok(Self::Year),
            _ => Err(ApiError::InvalidRange),
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Today => "today",
            Self::Yesterday => "yesterday",
            Self::Week => "week",
            Self::Month => "month",
            Self::Year => "year",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedRange {
    pub key: RangeKey,
    pub start_ms: i64,
    pub end_ms: i64,
    pub timezone: String,
}

impl ResolvedRange {
    pub(crate) fn aggregate_range(&self) -> Result<TimeRange, ApiError> {
        TimeRange::new(self.start_ms, self.end_ms).map_err(|_| ApiError::InvalidRange)
    }
}

pub fn resolve_system_range(key: RangeKey) -> Result<ResolvedRange, ApiError> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ApiError::LocalTimeUnavailable)?
        .as_millis()
        .try_into()
        .map_err(|_| ApiError::LocalTimeUnavailable)?;
    let timezone = system_timezone_name()?;
    resolve_range_at(key, now_ms, &timezone)
}

pub fn resolve_range_at(
    key: RangeKey,
    now_utc_ms: i64,
    timezone: &str,
) -> Result<ResolvedRange, ApiError> {
    let zone = TzifZone::load(timezone)?;
    resolve_with_zone(key, now_utc_ms, timezone, &zone)
}

fn resolve_with_zone(
    key: RangeKey,
    now_utc_ms: i64,
    timezone: &str,
    zone: &TzifZone,
) -> Result<ResolvedRange, ApiError> {
    let utc_seconds = now_utc_ms.div_euclid(1_000);
    let local_seconds = utc_seconds
        .checked_add(i64::from(zone.offset_at(utc_seconds)?))
        .ok_or(ApiError::LocalTimeUnavailable)?;
    let local_now = DateTime::from_timestamp(local_seconds, 0)
        .ok_or(ApiError::LocalTimeUnavailable)?
        .naive_utc();
    let today = local_now.date();
    let (start_date, end_date) = civil_dates(key, today)?;
    let start_ms = zone.local_midnight_to_utc_ms(start_date)?;
    let end_ms = zone.local_midnight_to_utc_ms(end_date)?;
    if start_ms > end_ms {
        return Err(ApiError::LocalTimeUnavailable);
    }
    Ok(ResolvedRange {
        key,
        start_ms,
        end_ms,
        timezone: timezone.to_owned(),
    })
}

fn civil_dates(key: RangeKey, today: NaiveDate) -> Result<(NaiveDate, NaiveDate), ApiError> {
    let next_day = |date: NaiveDate| {
        date.checked_add_days(Days::new(1))
            .ok_or(ApiError::LocalTimeUnavailable)
    };
    match key {
        RangeKey::Today => Ok((today, next_day(today)?)),
        RangeKey::Yesterday => Ok((
            today
                .checked_sub_days(Days::new(1))
                .ok_or(ApiError::LocalTimeUnavailable)?,
            today,
        )),
        RangeKey::Week => {
            let start = today
                .checked_sub_days(Days::new(u64::from(today.weekday().num_days_from_monday())))
                .ok_or(ApiError::LocalTimeUnavailable)?;
            let end = start
                .checked_add_days(Days::new(7))
                .ok_or(ApiError::LocalTimeUnavailable)?;
            Ok((start, end))
        }
        RangeKey::Month => {
            let start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                .ok_or(ApiError::LocalTimeUnavailable)?;
            let (year, month) = if today.month() == 12 {
                (today.year().checked_add(1), 1)
            } else {
                (Some(today.year()), today.month() + 1)
            };
            let end =
                NaiveDate::from_ymd_opt(year.ok_or(ApiError::LocalTimeUnavailable)?, month, 1)
                    .ok_or(ApiError::LocalTimeUnavailable)?;
            Ok((start, end))
        }
        RangeKey::Year => {
            let start = NaiveDate::from_ymd_opt(today.year(), 1, 1)
                .ok_or(ApiError::LocalTimeUnavailable)?;
            let end = NaiveDate::from_ymd_opt(
                today
                    .year()
                    .checked_add(1)
                    .ok_or(ApiError::LocalTimeUnavailable)?,
                1,
                1,
            )
            .ok_or(ApiError::LocalTimeUnavailable)?;
            Ok((start, end))
        }
    }
}

fn system_timezone_name() -> Result<String, ApiError> {
    if let Some(name) = env::var_os("TZ").and_then(|value| value.into_string().ok()) {
        if valid_timezone_name(&name) {
            return Ok(name);
        }
        return Err(ApiError::LocalTimeUnavailable);
    }
    let localtime = fs::read_link("/etc/localtime").map_err(|_| ApiError::LocalTimeUnavailable)?;
    timezone_name_from_path(&localtime).ok_or(ApiError::LocalTimeUnavailable)
}

fn timezone_name_from_path(path: &Path) -> Option<String> {
    let components = path.components().collect::<Vec<_>>();
    let marker = components.iter().rposition(
        |component| matches!(component, Component::Normal(value) if *value == "zoneinfo"),
    )?;
    let name = components[marker + 1..]
        .iter()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    valid_timezone_name(&name).then_some(name)
}

fn valid_timezone_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && name.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'+'))
        })
}

#[derive(Clone, Copy, Debug)]
struct ZoneTransition {
    utc_seconds: i64,
    offset_seconds: i32,
}

#[derive(Clone, Debug)]
struct TzifZone {
    initial_offset: i32,
    transitions: Vec<ZoneTransition>,
    offsets: Vec<i32>,
}

impl TzifZone {
    fn load(name: &str) -> Result<Self, ApiError> {
        if !valid_timezone_name(name) {
            return Err(ApiError::LocalTimeUnavailable);
        }
        let path = [
            PathBuf::from("/usr/share/zoneinfo").join(name),
            PathBuf::from("/var/db/timezone/zoneinfo").join(name),
        ]
        .into_iter()
        .find(|path| path.is_file())
        .ok_or(ApiError::LocalTimeUnavailable)?;
        let bytes = fs::read(path).map_err(|_| ApiError::LocalTimeUnavailable)?;
        Self::parse(&bytes)
    }

    fn parse(bytes: &[u8]) -> Result<Self, ApiError> {
        let first = TzifHeader::parse(bytes, 0)?;
        let (header, block_start, time_width) = if matches!(first.version, b'2' | b'3' | b'4') {
            let second_header = 44_usize
                .checked_add(first.block_len(4)?)
                .ok_or(ApiError::LocalTimeUnavailable)?;
            (
                TzifHeader::parse(bytes, second_header)?,
                second_header
                    .checked_add(44)
                    .ok_or(ApiError::LocalTimeUnavailable)?,
                8,
            )
        } else {
            (first, 44, 4)
        };
        header.parse_block(bytes, block_start, time_width)
    }

    fn offset_at(&self, utc_seconds: i64) -> Result<i32, ApiError> {
        let index = self
            .transitions
            .partition_point(|transition| transition.utc_seconds <= utc_seconds);
        Ok(index
            .checked_sub(1)
            .map(|index| self.transitions[index].offset_seconds)
            .unwrap_or(self.initial_offset))
    }

    fn local_midnight_to_utc_ms(&self, date: NaiveDate) -> Result<i64, ApiError> {
        let midnight = date
            .and_hms_opt(0, 0, 0)
            .ok_or(ApiError::LocalTimeUnavailable)?;
        let local_seconds = midnight.and_utc().timestamp();
        let mut candidates = self
            .offsets
            .iter()
            .filter_map(|offset| {
                let utc = local_seconds.checked_sub(i64::from(*offset))?;
                (self.offset_at(utc).ok()? == *offset).then_some(utc)
            })
            .collect::<Vec<_>>();
        candidates.sort_unstable();
        candidates.dedup();
        let utc_seconds = if let Some(earliest) = candidates.first().copied() {
            earliest
        } else {
            self.gap_end(local_seconds)
                .ok_or(ApiError::LocalTimeUnavailable)?
        };
        utc_seconds
            .checked_mul(1_000)
            .ok_or(ApiError::LocalTimeUnavailable)
    }

    fn gap_end(&self, local_seconds: i64) -> Option<i64> {
        let mut prior = self.initial_offset;
        for transition in &self.transitions {
            let next = transition.offset_seconds;
            if next > prior {
                let before = transition.utc_seconds.checked_add(i64::from(prior))?;
                let after = transition.utc_seconds.checked_add(i64::from(next))?;
                if (before..after).contains(&local_seconds) {
                    return Some(transition.utc_seconds);
                }
            }
            prior = next;
        }
        None
    }
}

#[derive(Clone, Copy)]
struct TzifHeader {
    version: u8,
    ttisgmtcnt: usize,
    ttisstdcnt: usize,
    leapcnt: usize,
    timecnt: usize,
    typecnt: usize,
    charcnt: usize,
}

impl TzifHeader {
    fn parse(bytes: &[u8], start: usize) -> Result<Self, ApiError> {
        let header = bytes
            .get(
                start
                    ..start
                        .checked_add(44)
                        .ok_or(ApiError::LocalTimeUnavailable)?,
            )
            .ok_or(ApiError::LocalTimeUnavailable)?;
        if &header[..4] != b"TZif" {
            return Err(ApiError::LocalTimeUnavailable);
        }
        let count = |offset| {
            let raw: [u8; 4] = header[offset..offset + 4]
                .try_into()
                .map_err(|_| ApiError::LocalTimeUnavailable)?;
            usize::try_from(u32::from_be_bytes(raw)).map_err(|_| ApiError::LocalTimeUnavailable)
        };
        let value = Self {
            version: header[4],
            ttisgmtcnt: count(20)?,
            ttisstdcnt: count(24)?,
            leapcnt: count(28)?,
            timecnt: count(32)?,
            typecnt: count(36)?,
            charcnt: count(40)?,
        };
        if value.typecnt == 0 || value.typecnt > 256 {
            return Err(ApiError::LocalTimeUnavailable);
        }
        Ok(value)
    }

    fn block_len(self, time_width: usize) -> Result<usize, ApiError> {
        self.timecnt
            .checked_mul(time_width)
            .and_then(|value| value.checked_add(self.timecnt))
            .and_then(|value| value.checked_add(self.typecnt.checked_mul(6)?))
            .and_then(|value| value.checked_add(self.charcnt))
            .and_then(|value| value.checked_add(self.leapcnt.checked_mul(time_width + 4)?))
            .and_then(|value| value.checked_add(self.ttisstdcnt))
            .and_then(|value| value.checked_add(self.ttisgmtcnt))
            .ok_or(ApiError::LocalTimeUnavailable)
    }

    fn parse_block(
        self,
        bytes: &[u8],
        start: usize,
        time_width: usize,
    ) -> Result<TzifZone, ApiError> {
        let end = start
            .checked_add(self.block_len(time_width)?)
            .ok_or(ApiError::LocalTimeUnavailable)?;
        let block = bytes
            .get(start..end)
            .ok_or(ApiError::LocalTimeUnavailable)?;
        let times_bytes = self
            .timecnt
            .checked_mul(time_width)
            .ok_or(ApiError::LocalTimeUnavailable)?;
        let mut times = Vec::with_capacity(self.timecnt);
        for chunk in block[..times_bytes].chunks_exact(time_width) {
            let value = if time_width == 8 {
                i64::from_be_bytes(
                    chunk
                        .try_into()
                        .map_err(|_| ApiError::LocalTimeUnavailable)?,
                )
            } else {
                i64::from(i32::from_be_bytes(
                    chunk
                        .try_into()
                        .map_err(|_| ApiError::LocalTimeUnavailable)?,
                ))
            };
            times.push(value);
        }
        let indices = block
            .get(times_bytes..times_bytes + self.timecnt)
            .ok_or(ApiError::LocalTimeUnavailable)?;
        let types_start = times_bytes + self.timecnt;
        let types_end = types_start
            .checked_add(self.typecnt * 6)
            .ok_or(ApiError::LocalTimeUnavailable)?;
        let types = block
            .get(types_start..types_end)
            .ok_or(ApiError::LocalTimeUnavailable)?;
        let mut offsets = Vec::with_capacity(self.typecnt);
        for chunk in types.chunks_exact(6) {
            offsets.push(i32::from_be_bytes(
                chunk[..4]
                    .try_into()
                    .map_err(|_| ApiError::LocalTimeUnavailable)?,
            ));
        }
        let initial_offset = offsets[0];
        let transitions = times
            .into_iter()
            .zip(indices.iter().copied())
            .map(|(utc_seconds, index)| {
                let offset_seconds = offsets
                    .get(usize::from(index))
                    .copied()
                    .ok_or(ApiError::LocalTimeUnavailable)?;
                Ok(ZoneTransition {
                    utc_seconds,
                    offset_seconds,
                })
            })
            .collect::<Result<Vec<_>, ApiError>>()?;
        let offsets = offsets
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        Ok(TzifZone {
            initial_offset,
            transitions,
            offsets,
        })
    }
}

#[cfg(test)]
#[path = "range/tests/spec05_p2.rs"]
mod spec05_p2;

#[cfg(test)]
mod tests {
    use chrono::DateTime;

    use super::*;

    fn shanghai_range(key: RangeKey) -> ResolvedRange {
        let now = DateTime::parse_from_rfc3339("2026-08-08T12:34:56+08:00")
            .unwrap()
            .timestamp_millis();
        resolve_range_at(key, now, "Asia/Shanghai").unwrap()
    }

    #[test]
    fn named_range_matrix_covers_calendar_boundaries_and_transition_rules() {
        let expected = [
            (
                RangeKey::Today,
                "2026-08-07T16:00:00Z",
                "2026-08-08T16:00:00Z",
            ),
            (
                RangeKey::Yesterday,
                "2026-08-06T16:00:00Z",
                "2026-08-07T16:00:00Z",
            ),
            (
                RangeKey::Week,
                "2026-08-02T16:00:00Z",
                "2026-08-09T16:00:00Z",
            ),
            (
                RangeKey::Month,
                "2026-07-31T16:00:00Z",
                "2026-08-31T16:00:00Z",
            ),
            (
                RangeKey::Year,
                "2025-12-31T16:00:00Z",
                "2026-12-31T16:00:00Z",
            ),
        ];
        for (key, start, end) in expected {
            let range = shanghai_range(key);
            assert_eq!(
                range.start_ms,
                DateTime::parse_from_rfc3339(start)
                    .unwrap()
                    .timestamp_millis()
            );
            assert_eq!(
                range.end_ms,
                DateTime::parse_from_rfc3339(end)
                    .unwrap()
                    .timestamp_millis()
            );
        }

        // Named `today` also exercises real tzdb midnight gap/overlap rules.
        let havana_gap_now = DateTime::parse_from_rfc3339("2026-03-08T12:00:00Z")
            .unwrap()
            .timestamp_millis();
        let havana_gap =
            resolve_range_at(RangeKey::Today, havana_gap_now, "America/Havana").unwrap();
        assert_eq!(
            havana_gap.start_ms,
            DateTime::parse_from_rfc3339("2026-03-08T05:00:00Z")
                .unwrap()
                .timestamp_millis()
        );
        assert_eq!(
            havana_gap.end_ms,
            DateTime::parse_from_rfc3339("2026-03-09T04:00:00Z")
                .unwrap()
                .timestamp_millis()
        );
        let havana_overlap_now = DateTime::parse_from_rfc3339("2026-11-01T12:00:00Z")
            .unwrap()
            .timestamp_millis();
        let havana_overlap =
            resolve_range_at(RangeKey::Today, havana_overlap_now, "America/Havana").unwrap();
        assert_eq!(
            havana_overlap.start_ms,
            DateTime::parse_from_rfc3339("2026-11-01T04:00:00Z")
                .unwrap()
                .timestamp_millis()
        );
        assert_eq!(
            havana_overlap.end_ms,
            DateTime::parse_from_rfc3339("2026-11-02T05:00:00Z")
                .unwrap()
                .timestamp_millis()
        );

        let synthetic = TzifZone {
            initial_offset: 0,
            transitions: vec![
                ZoneTransition {
                    utc_seconds: 86_400,
                    offset_seconds: 3_600,
                },
                ZoneTransition {
                    utc_seconds: 169_200,
                    offset_seconds: 0,
                },
                ZoneTransition {
                    utc_seconds: 259_200,
                    offset_seconds: 86_400,
                },
            ],
            offsets: vec![0, 3_600, 86_400],
        };
        let gap_date = NaiveDate::from_ymd_opt(1970, 1, 2).unwrap();
        assert_eq!(
            synthetic.local_midnight_to_utc_ms(gap_date).unwrap(),
            86_400_000
        );
        let local = 169_200;
        let candidates = synthetic
            .offsets
            .iter()
            .filter_map(|offset| {
                let utc = local - i64::from(*offset);
                (synthetic.offset_at(utc).ok()? == *offset).then_some(utc)
            })
            .collect::<Vec<_>>();
        assert_eq!(candidates.into_iter().min(), Some(165_600));
        let skipped = NaiveDate::from_ymd_opt(1970, 1, 4).unwrap();
        let following = NaiveDate::from_ymd_opt(1970, 1, 5).unwrap();
        assert_eq!(
            synthetic.local_midnight_to_utc_ms(skipped).unwrap(),
            synthetic.local_midnight_to_utc_ms(following).unwrap()
        );

        assert_eq!(RangeKey::parse(None), Err(ApiError::InvalidRange));
        assert_eq!(
            RangeKey::parse(Some("quarter")),
            Err(ApiError::InvalidRange)
        );
        for timezone in ["", "/absolute", "../escape", "Missing/Timezone"] {
            assert_eq!(
                resolve_range_at(RangeKey::Today, 0, timezone),
                Err(ApiError::LocalTimeUnavailable)
            );
        }
        assert_eq!(
            resolve_range_at(RangeKey::Today, i64::MAX, "Asia/Shanghai"),
            Err(ApiError::LocalTimeUnavailable)
        );
    }
}
