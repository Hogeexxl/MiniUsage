from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def load(p): return (ROOT/p).read_text(encoding='utf-8')
def save(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def once(s,old,new,label):
    c=s.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 match, got {c}')
    return s.replace(old,new,1)

# ---------------- aggregate health projection ----------------
p='src/usage/aggregate.rs'; s=load(p)
s=once(s,
'''#[derive(Clone, Debug, PartialEq)]
pub struct UsageSummary {
    pub totals: TokenTotals,
    pub session_count: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SessionUsageRow {''',
'''#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionDataStatus {
    Complete,
    Incomplete,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionHealthSummary {
    pub total_sessions: i64,
    pub complete_sessions: i64,
    pub incomplete_sessions: i64,
    pub error_sessions: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UsageSummary {
    pub totals: TokenTotals,
    /// Healthy sessions contributing usage events. Kept for the existing KPI.
    pub session_count: i64,
    pub health: SessionHealthSummary,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SessionUsageRow {''','aggregate health structs')
s=once(s,
'''    pub models_used: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SessionUsagePage''',
'''    pub models_used: Vec<String>,
    pub data_status: SessionDataStatus,
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SessionUsagePage''','session row health')
s=once(s,
'''    pub total_tokens: i64,
    pub combined_total_tokens: i64,
    pub cache_hit_rate: Option<f64>,
}''',
'''    pub total_tokens: Option<i64>,
    pub combined_total_tokens: Option<i64>,
    pub cache_hit_rate: Option<f64>,
    pub data_status: SessionDataStatus,
    pub error_code: Option<String>,
}''','sort health')
s=once(s,
'''            total_tokens: self.self_usage.total_tokens,
            combined_total_tokens: self.inclusive_usage.total_tokens,
            cache_hit_rate: self.inclusive_usage.cache_hit_rate,
        }''',
'''            total_tokens: Some(self.self_usage.total_tokens),
            combined_total_tokens: Some(self.inclusive_usage.total_tokens),
            cache_hit_rate: self.inclusive_usage.cache_hit_rate,
            data_status: status_for_totals(&self.inclusive_usage),
            error_code: None,
        }''','healthy sort health')
# Summary compute health.
s=once(s,
'''        Ok(UsageSummary {
            totals,
            session_count,
        })
    }''',
'''        let incomplete_sessions: i64 = self
            .connection
            .query_row(
                &format!(
                    "SELECT COUNT(DISTINCT ue.root_session_id)
                     FROM usage_events ue
                     LEFT JOIN threads root ON root.thread_id=ue.root_session_id
                     WHERE {} AND ue.estimated_cost_nanos_usd IS NULL",
                    summary_where_clause(query.filter())
                ),
                params_from_iter(values.iter()),
                |row| row.get(0),
            )
            .map_err(map_sql_error)?;
        let error_sessions = i64::try_from(
            self.quarantined_roots(epoch, range, query.filter())?.len(),
        )
        .map_err(|_| AggregateError::ArithmeticOverflow)?;
        let complete_sessions = session_count
            .checked_sub(incomplete_sessions)
            .ok_or(AggregateError::InvariantViolation)?;
        let total_sessions = session_count
            .checked_add(error_sessions)
            .ok_or(AggregateError::ArithmeticOverflow)?;
        Ok(UsageSummary {
            totals,
            session_count,
            health: SessionHealthSummary {
                total_sessions,
                complete_sessions,
                incomplete_sessions,
                error_sessions,
            },
        })
    }''','summary health')
# Rewrite session_snapshot + rows to union quarantine.
old='''        let roots = self.eligible_roots(epoch, range, filter)?;
        let aggregates = self.session_sort_aggregates(epoch, range, &roots)?;
        let mut sort_index = aggregates
            .iter()
            .map(|aggregate| aggregate.sort_index_item())
            .collect::<Vec<_>>();
        sort_index.sort_by(|left, right| left.root_session_id.cmp(&right.root_session_id));
        let mut seed_aggregates = aggregates;
        seed_aggregates.sort_by(|left, right| {
            compare_sort_aggregates(left, right, seed_sort_field, seed_sort_order)
        });
        seed_aggregates.truncate(MAX_SESSION_ROWS);
        let seed_rows = seed_aggregates
            .iter()
            .map(|aggregate| self.session_row_for_root(epoch, range, &aggregate.root_session_id))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(SessionSnapshot {
            sort_index,
            rows: seed_rows,
        })'''
new='''        let roots = self.eligible_roots(epoch, range, filter)?;
        let aggregates = self.session_sort_aggregates(epoch, range, &roots)?;
        let mut sort_index = aggregates
            .iter()
            .map(|aggregate| aggregate.sort_index_item())
            .collect::<Vec<_>>();
        let quarantined = self.quarantined_roots(epoch, range, filter)?;
        sort_index.extend(quarantined.iter().map(QuarantinedRoot::sort_index_item));
        let mut seed_index = sort_index.clone();
        seed_index.sort_by(|left, right| {
            compare_sort_index_items(left, right, seed_sort_field, seed_sort_order)
        });
        seed_index.truncate(MAX_SESSION_ROWS);
        let error_roots = quarantined
            .into_iter()
            .map(|root| (root.root_session_id.clone(), root))
            .collect::<BTreeMap<_, _>>();
        let seed_rows = seed_index
            .iter()
            .map(|item| match error_roots.get(&item.root_session_id) {
                Some(root) => Ok(root.session_row()),
                None => self.session_row_for_root(epoch, range, &item.root_session_id),
            })
            .collect::<Result<Vec<_>, _>>()?;
        sort_index.sort_by(|left, right| left.root_session_id.cmp(&right.root_session_id));
        Ok(SessionSnapshot { sort_index, rows: seed_rows })'''
s=once(s,old,new,'session snapshot union')
old='''        let eligible = self
            .eligible_roots(epoch, range, filter)?
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        if root_session_ids.iter().any(|id| !eligible.contains(id)) {
            return Err(AggregateError::InvalidSessionIds);
        }
        root_session_ids
            .iter()
            .map(|root| self.session_row_for_root(epoch, range, root))
            .collect()'''
new='''        let mut eligible = self
            .eligible_roots(epoch, range, filter)?
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        let error_roots = self
            .quarantined_roots(epoch, range, filter)?
            .into_iter()
            .map(|root| {
                eligible.insert(root.root_session_id.clone());
                (root.root_session_id.clone(), root)
            })
            .collect::<BTreeMap<_, _>>();
        if root_session_ids.iter().any(|id| !eligible.contains(id)) {
            return Err(AggregateError::InvalidSessionIds);
        }
        root_session_ids
            .iter()
            .map(|root| match error_roots.get(root) {
                Some(error) => Ok(error.session_row()),
                None => self.session_row_for_root(epoch, range, root),
            })
            .collect()'''
s=once(s,old,new,'session rows union')
# Healthy row status.
s=once(s,
'''            last_activity_at_ms,
            models_used,
        })
    }

    fn aggregate_for_root''',
'''            last_activity_at_ms,
            models_used,
            data_status: status_for_totals(&inclusive_usage),
            error_code: None,
        })
    }

    fn quarantined_roots(
        &self,
        epoch: i64,
        range: TimeRange,
        filter: &UsageFilter,
    ) -> Result<Vec<QuarantinedRoot>, AggregateError> {
        // A quarantined Session has no trustworthy usage/model ledger. Never
        // guess model-filter membership; under an active model filter it is
        // intentionally omitted from the scoped denominator/list.
        if !filter.models.is_empty() {
            return Ok(Vec::new());
        }
        let mut clauses = vec![
            "q.ledger_epoch=?1".to_owned(),
            "q.last_activity_at_ms>=?2".to_owned(),
            "q.last_activity_at_ms<?3".to_owned(),
        ];
        let mut values = vec![
            Value::Integer(epoch),
            Value::Integer(range.start_ms),
            Value::Integer(range.end_ms),
        ];
        let mut next = 4_usize;
        let mut projects = Vec::new();
        if !filter.project_paths.is_empty() {
            let placeholders = (next..next + filter.project_paths.len())
                .map(|value| format!("?{value}"))
                .collect::<Vec<_>>()
                .join(",");
            projects.push(format!(
                "(root.project_kind='project' AND root.project_path IN ({placeholders}))"
            ));
            values.extend(filter.project_paths.iter().cloned().map(Value::Text));
            next += filter.project_paths.len();
        }
        if filter.include_projectless {
            projects.push("root.project_kind='projectless'".to_owned());
        }
        if filter.include_unknown_project {
            projects.push("root.project_kind='unknown'".to_owned());
        }
        if !projects.is_empty() {
            clauses.push(format!("({})", projects.join(" OR ")));
        }
        let sql = format!(
            "SELECT q.root_session_id,q.primary_error_code,q.last_activity_at_ms,
                    root.title,root.project_name,root.project_path,
                    (SELECT COUNT(*) FROM threads child
                     WHERE child.root_session_id=q.root_session_id
                       AND child.thread_id<>q.root_session_id)
             FROM usage_session_quarantine q
             JOIN threads root ON root.thread_id=q.root_session_id
             WHERE {} ORDER BY q.root_session_id",
            clauses.join(" AND ")
        );
        let mut statement = self.connection.prepare(&sql).map_err(map_sql_error)?;
        statement
            .query_map(params_from_iter(values.iter()), |row| {
                Ok(QuarantinedRoot {
                    root_session_id: row.get(0)?,
                    error_code: row.get(1)?,
                    last_activity_at_ms: row.get(2)?,
                    title: row.get(3)?,
                    project_name: row.get(4)?,
                    project_path: row.get(5)?,
                    subagent_count: row.get(6)?,
                })
            })
            .map_err(map_sql_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(map_sql_error)
    }

    fn aggregate_for_root''','healthy status + quarantine query')
# Add helper structs before compare_sort_aggregates.
anchor='fn compare_sort_aggregates('
helpers='''#[derive(Clone, Debug)]
struct QuarantinedRoot {
    root_session_id: String,
    error_code: String,
    last_activity_at_ms: i64,
    title: Option<String>,
    project_name: Option<String>,
    project_path: Option<String>,
    subagent_count: i64,
}

impl QuarantinedRoot {
    fn sort_index_item(&self) -> SessionSortIndexItem {
        SessionSortIndexItem {
            root_session_id: self.root_session_id.clone(),
            last_activity_at_ms: self.last_activity_at_ms,
            project_sort_key: self.project_name.clone().or_else(|| self.project_path.clone()),
            model_sort_key: None,
            total_tokens: None,
            combined_total_tokens: None,
            cache_hit_rate: None,
            data_status: SessionDataStatus::Error,
            error_code: Some(self.error_code.clone()),
        }
    }

    fn session_row(&self) -> SessionUsageRow {
        SessionUsageRow {
            root_session_id: self.root_session_id.clone(),
            title: self.title.clone(),
            project_name: self.project_name.clone(),
            project_path: self.project_path.clone(),
            inclusive_usage: TokenTotals::zero(),
            self_usage: TokenTotals::zero(),
            subagent_usage: TokenTotals::zero(),
            subagent_count: self.subagent_count,
            last_activity_at_ms: self.last_activity_at_ms,
            models_used: Vec::new(),
            data_status: SessionDataStatus::Error,
            error_code: Some(self.error_code.clone()),
        }
    }
}

fn status_for_totals(totals: &TokenTotals) -> SessionDataStatus {
    match totals.cost_completeness {
        CostCompleteness::Partial | CostCompleteness::Unknown => SessionDataStatus::Incomplete,
        CostCompleteness::Empty | CostCompleteness::Complete => SessionDataStatus::Complete,
    }
}

fn compare_sort_index_items(
    left: &SessionSortIndexItem,
    right: &SessionSortIndexItem,
    field: SessionSortField,
    order: SessionSortOrder,
) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let text = |left: Option<&str>, right: Option<&str>| match (left, right) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => match order {
            SessionSortOrder::Asc => left.cmp(right),
            SessionSortOrder::Desc => right.cmp(left),
        },
    };
    let number = |left: Option<i64>, right: Option<i64>| match (left, right) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => match order {
            SessionSortOrder::Asc => left.cmp(&right),
            SessionSortOrder::Desc => right.cmp(&left),
        },
    };
    let ratio = |left: Option<f64>, right: Option<f64>| match (left, right) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => match order {
            SessionSortOrder::Asc => left.total_cmp(&right),
            SessionSortOrder::Desc => right.total_cmp(&left),
        },
    };
    let result = match field {
        SessionSortField::LastActivity => number(Some(left.last_activity_at_ms), Some(right.last_activity_at_ms)),
        SessionSortField::Project => text(left.project_sort_key.as_deref(), right.project_sort_key.as_deref()),
        SessionSortField::Model => text(left.model_sort_key.as_deref(), right.model_sort_key.as_deref()),
        SessionSortField::TotalTokens => number(left.total_tokens, right.total_tokens),
        SessionSortField::CombinedTotalTokens => number(left.combined_total_tokens, right.combined_total_tokens),
        SessionSortField::CacheHitRate => ratio(left.cache_hit_rate, right.cache_hit_rate),
    };
    result.then_with(|| left.root_session_id.cmp(&right.root_session_id))
}

'''
if anchor not in s: raise SystemExit('compare anchor missing')
s=s.replace(anchor,helpers+anchor,1)
# compare existing aggregate needs Option wrapping because sort index only; no change.
# Aggregate fixture needs quarantine tables + thread columns used by eligibility.
s=once(s,
'''                 CREATE TABLE threads (
                    thread_id TEXT PRIMARY KEY, title TEXT, project_name TEXT, project_path TEXT,
                    project_kind TEXT NOT NULL DEFAULT 'project'
                 );''',
'''                 CREATE TABLE threads (
                    thread_id TEXT PRIMARY KEY, parent_thread_id TEXT, root_session_id TEXT,
                    agent_role TEXT NOT NULL DEFAULT 'main', title TEXT, project_name TEXT, project_path TEXT,
                    project_kind TEXT NOT NULL DEFAULT 'project'
                 );''','fixture thread schema')
s=once(s,
'''                 INSERT INTO app_meta(id, usage_active_epoch) VALUES (1, 7);
                 INSERT INTO threads(thread_id,title,project_name,project_path) VALUES
                    ('root-a','Root A','project-a','{project_a}'),
                    ('child-a','Child A','project-a','{project_a}'),
                    ('root-b','Root B','project-b','{project_b}');"''',
'''                 CREATE TABLE usage_session_quarantine (
                    ledger_epoch INTEGER NOT NULL, root_session_id TEXT NOT NULL,
                    primary_error_code TEXT NOT NULL, last_activity_at_ms INTEGER NOT NULL,
                    first_seen_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
                 );
                 INSERT INTO app_meta(id, usage_active_epoch) VALUES (1, 7);
                 INSERT INTO threads(thread_id,parent_thread_id,root_session_id,agent_role,title,project_name,project_path) VALUES
                    ('root-a',NULL,'root-a','main','Root A','project-a','{project_a}'),
                    ('child-a','root-a','root-a','subagent','Child A','project-a','{project_a}'),
                    ('root-b',NULL,'root-b','main','Root B','project-b','{project_b}');"''','fixture thread rows')
save(p,s)

# ---------------- API DTO ----------------
p='src/api/query.rs'; s=load(p)
s=once(s,
'''            AggregateError, CostCompleteness, FilterOptions, ModelUsageRow, ProjectFilterOption,
            ReasoningEffortSummary, SessionDetail, SessionSortField, SessionSortIndexItem,
            SessionSortOrder, SessionUsageRow, TokenTotals, UsageFilter, UsageSummary,''',
'''            AggregateError, CostCompleteness, FilterOptions, ModelUsageRow, ProjectFilterOption,
            ReasoningEffortSummary, SessionDataStatus, SessionDetail, SessionSortField,
            SessionSortIndexItem, SessionSortOrder, SessionUsageRow, TokenTotals, UsageFilter,
            UsageSummary,''','api health import')
s=once(s,
'''pub struct SummaryUsageDto {
    pub input_tokens: i64,''',
'''pub struct SessionHealthDto {
    pub total_sessions: i64,
    pub complete_sessions: i64,
    pub incomplete_sessions: i64,
    pub error_sessions: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SummaryUsageDto {
    pub input_tokens: i64,''','summary health dto')
s=once(s,
'''    pub session_count: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SummaryResponse''',
'''    pub session_count: i64,
    pub session_health: SessionHealthDto,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SummaryResponse''','summary health field')
s=once(s,
'''    pub inclusive_usage: TokenUsageDto,
    pub self_usage: TokenUsageDto,
    pub subagent_usage: TokenUsageDto,
}''',
'''    pub inclusive_usage: Option<TokenUsageDto>,
    pub self_usage: Option<TokenUsageDto>,
    pub subagent_usage: Option<TokenUsageDto>,
    pub data_status: String,
    pub error_code: Option<String>,
}''','session dto nullable health')
s=once(s,
'''    pub total_tokens: i64,
    pub combined_total_tokens: i64,
    pub cache_hit_rate: Option<f64>,
}''',
'''    pub total_tokens: Option<i64>,
    pub combined_total_tokens: Option<i64>,
    pub cache_hit_rate: Option<f64>,
    pub data_status: String,
    pub error_code: Option<String>,
}''','sort dto nullable health')
# summary response checks/map
s=once(s,
'''    ensure_safe(snapshot.value.session_count)?;
    let tokens = map_totals(snapshot.value.totals)?;''',
'''    ensure_safe(snapshot.value.session_count)?;
    for value in [
        snapshot.value.health.total_sessions,
        snapshot.value.health.complete_sessions,
        snapshot.value.health.incomplete_sessions,
        snapshot.value.health.error_sessions,
    ] {
        ensure_safe(value)?;
    }
    let tokens = map_totals(snapshot.value.totals)?;''','summary health safe')
s=once(s,
'''            session_count: snapshot.value.session_count,
        },''',
'''            session_count: snapshot.value.session_count,
            session_health: SessionHealthDto {
                total_sessions: snapshot.value.health.total_sessions,
                complete_sessions: snapshot.value.health.complete_sessions,
                incomplete_sessions: snapshot.value.health.incomplete_sessions,
                error_sessions: snapshot.value.health.error_sessions,
            },
        },''','summary health map')
# session map
old='''        inclusive_usage: map_totals(row.inclusive_usage)?,
        self_usage: map_totals(row.self_usage)?,
        subagent_usage: map_totals(row.subagent_usage)?,
    })'''
new='''        inclusive_usage: (row.data_status != SessionDataStatus::Error)
            .then(|| map_totals(row.inclusive_usage))
            .transpose()?,
        self_usage: (row.data_status != SessionDataStatus::Error)
            .then(|| map_totals(row.self_usage))
            .transpose()?,
        subagent_usage: (row.data_status != SessionDataStatus::Error)
            .then(|| map_totals(row.subagent_usage))
            .transpose()?,
        data_status: session_status(row.data_status).to_owned(),
        error_code: row.error_code,
    })'''
s=once(s,old,new,'api session map')
# sort mapping optional safe
s=once(s,
'''    ensure_safe(row.total_tokens)?;
    ensure_safe(row.combined_total_tokens)?;''',
'''    if let Some(value) = row.total_tokens { ensure_safe(value)?; }
    if let Some(value) = row.combined_total_tokens { ensure_safe(value)?; }''','sort optional safe')
s=once(s,
'''        cache_hit_rate: row.cache_hit_rate,
    })
}''',
'''        cache_hit_rate: row.cache_hit_rate,
        data_status: session_status(row.data_status).to_owned(),
        error_code: row.error_code,
    })
}

fn session_status(status: SessionDataStatus) -> &'static str {
    match status {
        SessionDataStatus::Complete => "complete",
        SessionDataStatus::Incomplete => "incomplete",
        SessionDataStatus::Error => "error",
    }
}''','sort health map')
save(p,s)

# ---------------- frontend types ----------------
p='frontend/src/data/types.ts'; s=load(p)
s=once(s,
'''export type SummaryUsageDto = UsageDto & {
  session_count: number;
};''',
'''export type SessionHealthDto = {
  total_sessions: number;
  complete_sessions: number;
  incomplete_sessions: number;
  error_sessions: number;
};

export type SummaryUsageDto = UsageDto & {
  session_count: number;
  session_health: SessionHealthDto;
};''','frontend summary health')
s=once(s,
'''  inclusive_usage: UsageDto;
  self_usage: UsageDto;
  subagent_usage: UsageDto;
};''',
'''  inclusive_usage: UsageDto | null;
  self_usage: UsageDto | null;
  subagent_usage: UsageDto | null;
  data_status: "complete" | "incomplete" | "error";
  error_code: string | null;
};''','frontend session nullable')
s=once(s,
'''  total_tokens: number;
  combined_total_tokens: number;
  cache_hit_rate: number | null;
};''',
'''  total_tokens: number | null;
  combined_total_tokens: number | null;
  cache_hit_rate: number | null;
  data_status: "complete" | "incomplete" | "error";
  error_code: string | null;
};''','frontend sort nullable')
save(p,s)

# ---------------- metric notice severity + total token health ----------------
p='frontend/src/dashboard/MetricCard.tsx'; s=load(p)
s=once(s,
'''type MetricCardNotice = {
  ariaLabel: string;
  message: string;
};''',
'''type MetricCardNotice = {
  ariaLabel: string;
  message: string;
  severity?: "warning" | "error";
};''','metric notice severity type')
s=once(s,
'''            className="metric-notice-trigger"''',
'''            className={`metric-notice-trigger is-${notice.severity ?? "error"}`}''','metric notice class')
s=once(s,
'''{notice && noticeOpen ? <div id={noticeId} className="metric-notice-bubble" role="status">{notice.message}</div> : null}''',
'''{notice && noticeOpen ? <div id={noticeId} className={`metric-notice-bubble is-${notice.severity ?? "error"}`} role="status">{notice.message}</div> : null}''','metric bubble class')
save(p,s)

p='frontend/src/dashboard/MetricGrid.tsx'; s=load(p)
old='''function metricNotice(usage: SummaryUsageDto, key: (typeof METRIC_DEFINITIONS)[number]["key"]) {
  if (key !== "estimated_cost" || usage.estimated_cost_status === "complete") return undefined;
  return {
    ariaLabel: "预估费用完整性提示",
    message: usage.estimated_cost_status === "partial" ? "有部分费用不完整" : "当前费用无法完整估算",
  };
}'''
new='''function metricNotice(usage: SummaryUsageDto, key: (typeof METRIC_DEFINITIONS)[number]["key"]) {
  if (key === "total_tokens") {
    const { total_sessions: total, complete_sessions: complete, incomplete_sessions: incomplete, error_sessions: errors } = usage.session_health;
    if (errors > 0) {
      const suffix = incomplete > 0 ? `，${incomplete} 个不完整` : "";
      return {
        ariaLabel: "总 Token 数据完整性提示",
        message: `已计算 ${complete}/${total} 个 Session，${errors} 个异常未计入${suffix}`,
        severity: "error" as const,
      };
    }
    if (incomplete > 0) {
      return {
        ariaLabel: "总 Token 数据完整性提示",
        message: `已计算 ${complete}/${total} 个 Session，${incomplete} 个不完整`,
        severity: "warning" as const,
      };
    }
    return undefined;
  }
  if (key !== "estimated_cost" || usage.estimated_cost_status === "complete") return undefined;
  return {
    ariaLabel: "预估费用完整性提示",
    message: usage.estimated_cost_status === "partial" ? "有部分费用不完整" : "当前费用无法完整估算",
    severity: "warning" as const,
  };
}'''
s=once(s,old,new,'metric health notice')
save(p,s)

# ---------------- session row visual status ----------------
p='frontend/src/dashboard/session/SessionTableRow.tsx'; s=load(p)
s=once(s,
'''  const cost = formatCost(item.inclusive_usage.estimated_cost);
  const costClassName = item.inclusive_usage.estimated_cost_status === "partial"
    ? "session-cost-cell is-partial"
    : "session-cost-cell";
  const activate = () => onOpen?.(item);''',
'''  const isError = item.data_status === "error";
  const inclusive = item.inclusive_usage;
  const self = item.self_usage;
  const cost = formatCost(inclusive?.estimated_cost ?? null);
  const costClassName = item.data_status === "incomplete"
    ? "session-cost-cell is-partial"
    : "session-cost-cell";
  const activate = () => { if (!isError) onOpen?.(item); };
  const rowClassName = [selected ? "is-selected" : "", `is-${item.data_status}`].filter(Boolean).join(" ");''','row status setup')
s=once(s,
'''      className={selected ? "is-selected" : undefined}''',
'''      className={rowClassName || undefined}''','row class')
s=once(s,
'''      tabIndex={onOpen ? 0 : -1}''',
'''      tabIndex={onOpen && !isError ? 0 : -1}''','row tabindex')
s=once(s,
'''      onClick={onOpen ? activate : undefined}
      onKeyDown={onOpen ? (event) => {''',
'''      onClick={onOpen && !isError ? activate : undefined}
      onKeyDown={onOpen && !isError ? (event) => {''','row click guard')
s=once(s,
'''      <td className="session-text-cell" title={title}>{title}</td>''',
'''      <td className="session-text-cell" title={isError ? `${title} · 数据计算异常` : title}>
        <span className="session-title-content">
          {item.data_status !== "complete" ? (
            <span className={`session-health-icon is-${item.data_status}`} aria-label={item.data_status === "error" ? "数据计算异常" : "数据不完整"} title={item.data_status === "error" ? "数据计算异常" : "数据不完整"}>!</span>
          ) : null}
          <span className="session-title-text">{title}</span>
        </span>
      </td>''','row title icon')
s=once(s,
'''      <td className="session-number-cell" title={String(item.self_usage.total_tokens)} aria-label={String(item.self_usage.total_tokens)}>{formatSessionTokenInteger(item.self_usage.total_tokens).text}</td>
      <td className="session-number-cell" title={String(item.inclusive_usage.total_tokens)} aria-label={String(item.inclusive_usage.total_tokens)}>{formatSessionTokenInteger(item.inclusive_usage.total_tokens).text}</td>
      <td className="session-number-cell" title={formatRatio(item.inclusive_usage.cache_hit_rate).title}>{formatRatio(item.inclusive_usage.cache_hit_rate).text}</td>
      <td className={`session-number-cell ${costClassName}`} title={cost.title}>{cost.text}</td>''',
'''      <td className="session-number-cell" title={self ? String(self.total_tokens) : "数据计算异常"} aria-label={self ? String(self.total_tokens) : "数据计算异常"}>{self ? formatSessionTokenInteger(self.total_tokens).text : "—"}</td>
      <td className="session-number-cell" title={inclusive ? String(inclusive.total_tokens) : "数据计算异常"} aria-label={inclusive ? String(inclusive.total_tokens) : "数据计算异常"}>{inclusive ? formatSessionTokenInteger(inclusive.total_tokens).text : "—"}</td>
      <td className="session-number-cell" title={inclusive ? formatRatio(inclusive.cache_hit_rate).title : "数据计算异常"}>{inclusive ? formatRatio(inclusive.cache_hit_rate).text : "—"}</td>
      <td className={`session-number-cell ${costClassName}`} title={isError ? "数据计算异常" : cost.title}>{isError ? "—" : cost.text}</td>''','row nullable numeric')
save(p,s)

# ---------------- CSS ----------------
p='frontend/src/index.css'; s=load(p)
s=once(s,
'''.metric-notice-trigger:hover,
.metric-notice-trigger:focus-visible {
  background: #ffe4e6;
}''',
'''.metric-notice-trigger.is-warning {
  color: #d97706;
}

.metric-notice-trigger.is-warning:hover,
.metric-notice-trigger.is-warning:focus-visible {
  background: #fef3c7;
}

.metric-notice-trigger.is-error:hover,
.metric-notice-trigger.is-error:focus-visible {
  background: #ffe4e6;
}''','metric warning css')
s=once(s,
'''  overflow-wrap: anywhere;
}

.metric-skeleton''',
'''  overflow-wrap: anywhere;
}

.metric-notice-bubble.is-warning {
  border-color: #fde68a;
  color: #92400e;
  background: #fffbeb;
}

.metric-skeleton''','bubble warning css')
s=once(s,
'''.session-text-cell {
  overflow: hidden;
  text-overflow: ellipsis;
}''',
'''.session-text-cell {
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-table tbody tr.is-incomplete td:first-child {
  box-shadow: inset 3px 0 0 #f59e0b;
}

.session-table tbody tr.is-error td:first-child {
  box-shadow: inset 3px 0 0 #e11d48;
}

.session-table tbody tr.is-incomplete {
  background: #fffdf5;
}

.session-table tbody tr.is-error {
  background: #fff8f8;
}

.session-title-content {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 6px;
}

.session-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-health-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.session-health-icon.is-incomplete { color: #d97706; }
.session-health-icon.is-error { color: #be123c; }''','session health css')
save(p,s)

print('health API/UI patch applied')
