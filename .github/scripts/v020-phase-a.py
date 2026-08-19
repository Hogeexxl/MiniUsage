from pathlib import Path
import re


def replace(path: str, old: str, new: str, expected: int = 1) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, got {count}: {old[:100]!r}")
    target.write_text(source.replace(old, new))


aggregate = "src/usage/aggregate.rs"
replace(
    aggregate,
    "    pub session_count: i64,\n    pub health: SessionHealthSummary,\n",
    "    pub session_count: i64,\n    pub cost_incomplete_session_count: i64,\n    pub health: SessionHealthSummary,\n",
)
replace(
    aggregate,
    "    pub combined_total_tokens: Option<i64>,\n    pub cache_hit_rate: Option<f64>,\n",
    "    pub combined_total_tokens: Option<i64>,\n    pub combined_estimated_cost_nanos_usd: Option<i64>,\n    pub cache_hit_rate: Option<f64>,\n",
)
replace(
    aggregate,
    "    CombinedTotalTokens,\n    CacheHitRate,\n",
    "    CombinedTotalTokens,\n    CombinedEstimatedCost,\n    CacheHitRate,\n",
)
replace(
    aggregate,
    "            combined_total_tokens: Some(self.inclusive_usage.total_tokens),\n            cache_hit_rate: self.inclusive_usage.cache_hit_rate,\n",
    "            combined_total_tokens: Some(self.inclusive_usage.total_tokens),\n            combined_estimated_cost_nanos_usd: self.inclusive_usage.estimated_cost_nanos_usd,\n            cache_hit_rate: self.inclusive_usage.cache_hit_rate,\n",
)
replace(
    aggregate,
    "        Ok(UsageSummary {\n            totals,\n            session_count,\n            health: SessionHealthSummary {\n",
    "        Ok(UsageSummary {\n            totals,\n            session_count,\n            cost_incomplete_session_count: incomplete_sessions,\n            health: SessionHealthSummary {\n",
)
replace(
    aggregate,
    "            combined_total_tokens: None,\n            cache_hit_rate: None,\n",
    "            combined_total_tokens: None,\n            combined_estimated_cost_nanos_usd: None,\n            cache_hit_rate: None,\n",
)
replace(
    aggregate,
    "        SessionSortField::CombinedTotalTokens => {\n            number(left.combined_total_tokens, right.combined_total_tokens)\n        }\n        SessionSortField::CacheHitRate => ratio(left.cache_hit_rate, right.cache_hit_rate),\n",
    "        SessionSortField::CombinedTotalTokens => {\n            number(left.combined_total_tokens, right.combined_total_tokens)\n        }\n        SessionSortField::CombinedEstimatedCost => number(\n            left.combined_estimated_cost_nanos_usd,\n            right.combined_estimated_cost_nanos_usd,\n        ),\n        SessionSortField::CacheHitRate => ratio(left.cache_hit_rate, right.cache_hit_rate),\n",
)
replace(
    aggregate,
    "    let compare_number = |left: i64, right: i64| match order {\n        SessionSortOrder::Asc => left.cmp(&right),\n        SessionSortOrder::Desc => right.cmp(&left),\n    };\n    let compare_ratio = |left: Option<f64>, right: Option<f64>| match (left, right) {\n",
    "    let compare_number = |left: i64, right: i64| match order {\n        SessionSortOrder::Asc => left.cmp(&right),\n        SessionSortOrder::Desc => right.cmp(&left),\n    };\n    let compare_optional_number = |left: Option<i64>, right: Option<i64>| match (left, right) {\n        (None, None) => Ordering::Equal,\n        (None, Some(_)) => Ordering::Greater,\n        (Some(_), None) => Ordering::Less,\n        (Some(left), Some(right)) => match order {\n            SessionSortOrder::Asc => left.cmp(&right),\n            SessionSortOrder::Desc => right.cmp(&left),\n        },\n    };\n    let compare_ratio = |left: Option<f64>, right: Option<f64>| match (left, right) {\n",
)
replace(
    aggregate,
    "        SessionSortField::CombinedTotalTokens => compare_number(\n            left.inclusive_usage.total_tokens,\n            right.inclusive_usage.total_tokens,\n        ),\n        SessionSortField::CacheHitRate => compare_ratio(\n",
    "        SessionSortField::CombinedTotalTokens => compare_number(\n            left.inclusive_usage.total_tokens,\n            right.inclusive_usage.total_tokens,\n        ),\n        SessionSortField::CombinedEstimatedCost => compare_optional_number(\n            left.inclusive_usage.estimated_cost_nanos_usd,\n            right.inclusive_usage.estimated_cost_nanos_usd,\n        ),\n        SessionSortField::CacheHitRate => compare_ratio(\n",
)

path = Path(aggregate)
source = path.read_text()
marker = "        transaction.commit().unwrap();\n    }\n}\n"
if source.count(marker) != 1:
    raise SystemExit("aggregate test insertion marker mismatch")
source = source.replace(
    marker,
    '''        transaction.commit().unwrap();
    }

    #[test]
    fn v020_summary_reports_cost_incomplete_root_count() {
        let connection = cost_fixture();
        let reader = AggregateReader::new(&connection);
        let partial = reader
            .summary(SummaryQuery::new(
                TimeRange::new(0, 9).unwrap(),
                UsageFilter::default(),
            ))
            .unwrap();
        assert_eq!(partial.session_count, 1);
        assert_eq!(partial.cost_incomplete_session_count, 1);

        let complete = reader
            .summary(SummaryQuery::new(
                TimeRange::new(0, 4).unwrap(),
                UsageFilter::default(),
            ))
            .unwrap();
        assert_eq!(complete.cost_incomplete_session_count, 0);
    }

    #[test]
    fn v020_combined_estimated_cost_sort_is_null_last_for_both_orders() {
        fn item(id: &str, cost: Option<i64>) -> SessionSortIndexItem {
            SessionSortIndexItem {
                root_session_id: id.to_owned(),
                last_activity_at_ms: 1,
                project_sort_key: None,
                model_sort_key: None,
                total_tokens: Some(1),
                combined_total_tokens: Some(1),
                combined_estimated_cost_nanos_usd: cost,
                cache_hit_rate: None,
                data_status: SessionDataStatus::Complete,
                error_code: None,
            }
        }

        let mut rows = vec![item("unknown", None), item("low", Some(100)), item("high", Some(300))];
        rows.sort_by(|left, right| {
            compare_sort_index_items(
                left,
                right,
                SessionSortField::CombinedEstimatedCost,
                SessionSortOrder::Desc,
            )
        });
        assert_eq!(
            rows.iter().map(|row| row.root_session_id.as_str()).collect::<Vec<_>>(),
            vec!["high", "low", "unknown"]
        );

        rows.sort_by(|left, right| {
            compare_sort_index_items(
                left,
                right,
                SessionSortField::CombinedEstimatedCost,
                SessionSortOrder::Asc,
            )
        });
        assert_eq!(
            rows.iter().map(|row| row.root_session_id.as_str()).collect::<Vec<_>>(),
            vec!["low", "high", "unknown"]
        );
    }
}
''',
)
path.write_text(source)

query = "src/api/query.rs"
replace(
    query,
    "    pub session_count: i64,\n    pub session_health: SessionHealthDto,\n",
    "    pub session_count: i64,\n    pub cost_incomplete_session_count: i64,\n    pub session_health: SessionHealthDto,\n",
)
replace(
    query,
    "    pub combined_total_tokens: Option<i64>,\n    pub cache_hit_rate: Option<f64>,\n",
    "    pub combined_total_tokens: Option<i64>,\n    pub combined_estimated_cost: Option<f64>,\n    pub cache_hit_rate: Option<f64>,\n",
)
replace(
    query,
    '        "combined_total_tokens" => Ok(SessionSortField::CombinedTotalTokens),\n        "cache_hit_rate" => Ok(SessionSortField::CacheHitRate),\n',
    '        "combined_total_tokens" => Ok(SessionSortField::CombinedTotalTokens),\n        "combined_estimated_cost" => Ok(SessionSortField::CombinedEstimatedCost),\n        "cache_hit_rate" => Ok(SessionSortField::CacheHitRate),\n',
)
replace(
    query,
    "    ensure_safe(snapshot.value.session_count)?;\n    for value in [\n",
    "    ensure_safe(snapshot.value.session_count)?;\n    ensure_safe(snapshot.value.cost_incomplete_session_count)?;\n    for value in [\n",
)
replace(
    query,
    "            session_count: snapshot.value.session_count,\n            session_health: SessionHealthDto {\n",
    "            session_count: snapshot.value.session_count,\n            cost_incomplete_session_count: snapshot.value.cost_incomplete_session_count,\n            session_health: SessionHealthDto {\n",
)
replace(
    query,
    "    if let Some(value) = row.combined_total_tokens {\n        ensure_safe(value)?;\n    }\n    if row\n",
    "    if let Some(value) = row.combined_total_tokens {\n        ensure_safe(value)?;\n    }\n    let combined_estimated_cost = match row.combined_estimated_cost_nanos_usd {\n        Some(value) if value >= 0 => Some(value as f64 / 1_000_000_000.0),\n        Some(_) => return Err(ApiError::QueryFailed),\n        None => None,\n    };\n    if row\n",
)
replace(
    query,
    "        total_tokens: row.total_tokens,\n        combined_total_tokens: row.combined_total_tokens,\n        cache_hit_rate: row.cache_hit_rate,\n",
    "        total_tokens: row.total_tokens,\n        combined_total_tokens: row.combined_total_tokens,\n        combined_estimated_cost,\n        cache_hit_rate: row.cache_hit_rate,\n",
)

path = Path(query)
source = path.read_text()
source = re.sub(
    r'(UsageSummary \{(?:(?!UsageSummary \{).)*?\n\s*session_count: [^,]+,\n)(\s*health:)',
    r'\1            cost_incomplete_session_count: 0,\n\2',
    source,
    flags=re.S,
)
source = re.sub(
    r'(SessionSortIndexItem \{(?:(?!SessionSortIndexItem \{).)*?\n\s*combined_total_tokens: [^,]+,\n)(\s*cache_hit_rate:)',
    r'\1            combined_estimated_cost_nanos_usd: None,\n\2',
    source,
    flags=re.S,
)
path.write_text(source)
