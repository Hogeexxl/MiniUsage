from pathlib import Path
import subprocess


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, got {count}\n--- anchor ---\n{old}")
    p.write_text(text.replace(old, new, 1))


# Rust aggregate contract.
path = "src/usage/aggregate.rs"
replace_once(path,
'''pub struct UsageSummary {
    pub totals: TokenTotals,
    /// Healthy sessions contributing usage events. Kept for the existing KPI.
    pub session_count: i64,
    pub health: SessionHealthSummary,
}''',
'''pub struct UsageSummary {
    pub totals: TokenTotals,
    /// Healthy sessions contributing usage events. Kept for the existing KPI.
    pub session_count: i64,
    pub cost_incomplete_session_count: i64,
    pub health: SessionHealthSummary,
}''')
replace_once(path,
'''    pub total_tokens: Option<i64>,
    pub combined_total_tokens: Option<i64>,
    pub cache_hit_rate: Option<f64>,''',
'''    pub total_tokens: Option<i64>,
    pub combined_total_tokens: Option<i64>,
    pub combined_estimated_cost_nanos_usd: Option<i64>,
    pub cache_hit_rate: Option<f64>,''')
replace_once(path,
'''    TotalTokens,
    CombinedTotalTokens,
    CacheHitRate,
}''',
'''    TotalTokens,
    CombinedTotalTokens,
    CombinedEstimatedCost,
    CacheHitRate,
}''')
replace_once(path,
'''            total_tokens: Some(self.self_usage.total_tokens),
            combined_total_tokens: Some(self.inclusive_usage.total_tokens),
            cache_hit_rate: self.inclusive_usage.cache_hit_rate,''',
'''            total_tokens: Some(self.self_usage.total_tokens),
            combined_total_tokens: Some(self.inclusive_usage.total_tokens),
            combined_estimated_cost_nanos_usd: match self.inclusive_usage.cost_completeness {
                CostCompleteness::Complete | CostCompleteness::Partial => {
                    self.inclusive_usage.estimated_cost_nanos_usd
                }
                CostCompleteness::Empty | CostCompleteness::Unknown => None,
            },
            cache_hit_rate: self.inclusive_usage.cache_hit_rate,''')
replace_once(path,
'''        Ok(UsageSummary {
            totals,
            session_count,
            health: SessionHealthSummary {''',
'''        Ok(UsageSummary {
            totals,
            session_count,
            cost_incomplete_session_count: incomplete_sessions,
            health: SessionHealthSummary {''')
replace_once(path,
'''            total_tokens: None,
            combined_total_tokens: None,
            cache_hit_rate: None,''',
'''            total_tokens: None,
            combined_total_tokens: None,
            combined_estimated_cost_nanos_usd: None,
            cache_hit_rate: None,''')
replace_once(path,
'''        SessionSortField::CombinedTotalTokens => {
            number(left.combined_total_tokens, right.combined_total_tokens)
        }
        SessionSortField::CacheHitRate => ratio(left.cache_hit_rate, right.cache_hit_rate),''',
'''        SessionSortField::CombinedTotalTokens => {
            number(left.combined_total_tokens, right.combined_total_tokens)
        }
        SessionSortField::CombinedEstimatedCost => number(
            left.combined_estimated_cost_nanos_usd,
            right.combined_estimated_cost_nanos_usd,
        ),
        SessionSortField::CacheHitRate => ratio(left.cache_hit_rate, right.cache_hit_rate),''')
replace_once(path,
'''    let compare_number = |left: i64, right: i64| match order {
        SessionSortOrder::Asc => left.cmp(&right),
        SessionSortOrder::Desc => right.cmp(&left),
    };
    let compare_ratio = |left: Option<f64>, right: Option<f64>| match (left, right) {''',
'''    let compare_number = |left: i64, right: i64| match order {
        SessionSortOrder::Asc => left.cmp(&right),
        SessionSortOrder::Desc => right.cmp(&left),
    };
    let compare_optional_number = |left: Option<i64>, right: Option<i64>| match (left, right) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => match order {
            SessionSortOrder::Asc => left.cmp(&right),
            SessionSortOrder::Desc => right.cmp(&left),
        },
    };
    let compare_ratio = |left: Option<f64>, right: Option<f64>| match (left, right) {''')
replace_once(path,
'''        SessionSortField::CombinedTotalTokens => compare_number(
            left.inclusive_usage.total_tokens,
            right.inclusive_usage.total_tokens,
        ),
        SessionSortField::CacheHitRate => compare_ratio(''',
'''        SessionSortField::CombinedTotalTokens => compare_number(
            left.inclusive_usage.total_tokens,
            right.inclusive_usage.total_tokens,
        ),
        SessionSortField::CombinedEstimatedCost => compare_optional_number(
            match left.inclusive_usage.cost_completeness {
                CostCompleteness::Complete | CostCompleteness::Partial => {
                    left.inclusive_usage.estimated_cost_nanos_usd
                }
                CostCompleteness::Empty | CostCompleteness::Unknown => None,
            },
            match right.inclusive_usage.cost_completeness {
                CostCompleteness::Complete | CostCompleteness::Partial => {
                    right.inclusive_usage.estimated_cost_nanos_usd
                }
                CostCompleteness::Empty | CostCompleteness::Unknown => None,
            },
        ),
        SessionSortField::CacheHitRate => compare_ratio(''')

# HTTP projection.
path = "src/api/query.rs"
replace_once(path,
'''    pub estimated_cost_status: String,
    pub session_count: i64,
    pub session_health: SessionHealthDto,''',
'''    pub estimated_cost_status: String,
    pub session_count: i64,
    pub cost_incomplete_session_count: i64,
    pub session_health: SessionHealthDto,''')
replace_once(path,
'''    pub total_tokens: Option<i64>,
    pub combined_total_tokens: Option<i64>,
    pub cache_hit_rate: Option<f64>,''',
'''    pub total_tokens: Option<i64>,
    pub combined_total_tokens: Option<i64>,
    pub combined_estimated_cost: Option<f64>,
    pub cache_hit_rate: Option<f64>,''')
replace_once(path,
'''        "combined_total_tokens" => Ok(SessionSortField::CombinedTotalTokens),
        "cache_hit_rate" => Ok(SessionSortField::CacheHitRate),''',
'''        "combined_total_tokens" => Ok(SessionSortField::CombinedTotalTokens),
        "combined_estimated_cost" => Ok(SessionSortField::CombinedEstimatedCost),
        "cache_hit_rate" => Ok(SessionSortField::CacheHitRate),''')
replace_once(path,
'''    ensure_safe(snapshot.data_revision)?;
    ensure_safe(snapshot.value.session_count)?;
    for value in [''',
'''    ensure_safe(snapshot.data_revision)?;
    ensure_safe(snapshot.value.session_count)?;
    ensure_safe(snapshot.value.cost_incomplete_session_count)?;
    for value in [''')
replace_once(path,
'''            estimated_cost_status: tokens.estimated_cost_status,
            session_count: snapshot.value.session_count,
            session_health: SessionHealthDto {''',
'''            estimated_cost_status: tokens.estimated_cost_status,
            session_count: snapshot.value.session_count,
            cost_incomplete_session_count: snapshot.value.cost_incomplete_session_count,
            session_health: SessionHealthDto {''')
replace_once(path,
'''    if let Some(value) = row.combined_total_tokens {
        ensure_safe(value)?;
    }
    if row
        .cache_hit_rate''',
'''    if let Some(value) = row.combined_total_tokens {
        ensure_safe(value)?;
    }
    let combined_estimated_cost = match row.combined_estimated_cost_nanos_usd {
        Some(value) if value >= 0 => Some(value as f64 / 1_000_000_000.0),
        Some(_) => return Err(ApiError::QueryFailed),
        None => None,
    };
    if row
        .cache_hit_rate''')
replace_once(path,
'''        total_tokens: row.total_tokens,
        combined_total_tokens: row.combined_total_tokens,
        cache_hit_rate: row.cache_hit_rate,''',
'''        total_tokens: row.total_tokens,
        combined_total_tokens: row.combined_total_tokens,
        combined_estimated_cost,
        cache_hit_rate: row.cache_hit_rate,''')

# Frontend contract types: keep one formal path only.
path = "frontend/src/data/types.ts"
text = Path(path).read_text()
if "cost_incomplete_session_count" not in text:
    replace_once(path,
'''  estimated_cost_status: CostStatus;
  session_count: number;
  session_health: SessionHealthDto;''',
'''  estimated_cost_status: CostStatus;
  session_count: number;
  cost_incomplete_session_count: number;
  session_health: SessionHealthDto;''')
if '"combined_estimated_cost"' not in Path(path).read_text():
    replace_once(path,
'''  | "combined_total_tokens"
  | "cache_hit_rate";''',
'''  | "combined_total_tokens"
  | "combined_estimated_cost"
  | "cache_hit_rate";''')
    replace_once(path,
'''  total_tokens: number | null;
  combined_total_tokens: number | null;
  cache_hit_rate: number | null;''',
'''  total_tokens: number | null;
  combined_total_tokens: number | null;
  combined_estimated_cost: number | null;
  cache_hit_rate: number | null;''')

subprocess.run(["cargo", "fmt", "--all"], check=True)
subprocess.run(["npm", "install", "--package-lock-only", "--ignore-scripts"], cwd="frontend", check=True)

# Temporary implementation helpers do not remain in the product tree.
Path("tools/v020_contract_patch.py").unlink(missing_ok=True)
Path(".github/workflows/v020-contract-patch.yml").unlink(missing_ok=True)
