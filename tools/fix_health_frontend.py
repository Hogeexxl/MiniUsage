from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, label: str, expected: int) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, got {count}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# Keep the pre-existing cost-cell contract: only a known partial subtotal is
# highlighted. Session health is a separate row-level concern; an unknown cost
# stays as an em dash without the partial-cost class.
replace_once(
    "frontend/src/dashboard/session/SessionTableRow.tsx",
    '''  const costClassName = item.data_status === "incomplete"\n    ? "session-cost-cell is-partial"\n    : "session-cost-cell";''',
    '''  const costClassName = inclusive?.estimated_cost_status === "partial"\n    ? "session-cost-cell is-partial"\n    : "session-cost-cell";''',
    "session cost class",
)

# ---------------- strict frontend API decoding ----------------
# The health patch changes the wire contract. Keep the client seam strict: do
# not silently invent health/status fields and do not accept mixed error rows.
replace_once(
    "frontend/src/data/miniUsageClient.ts",
    '''function requiredEstimatedCostStatus(record: JsonRecord, key: string): EstimatedCostStatus {\n  const value = record[key];\n  if (value === "complete" || value === "partial" || value === "unknown") {\n    return value;\n  }\n  throw new MiniUsageClientError("HTTP_ERROR", 200);\n}\n\nfunction parseRange(value: unknown): RangeDto {''',
    '''function requiredEstimatedCostStatus(record: JsonRecord, key: string): EstimatedCostStatus {\n  const value = record[key];\n  if (value === "complete" || value === "partial" || value === "unknown") {\n    return value;\n  }\n  throw new MiniUsageClientError("HTTP_ERROR", 200);\n}\n\nfunction requiredSessionDataStatus(record: JsonRecord, key: string): SessionItemDto["data_status"] {\n  const value = record[key];\n  if (value === "complete" || value === "incomplete" || value === "error") return value;\n  throw new MiniUsageClientError("HTTP_ERROR", 200);\n}\n\nfunction parseRange(value: unknown): RangeDto {''',
    "session data status parser",
)

replace_once(
    "frontend/src/data/miniUsageClient.ts",
    '''function parseUsage(value: unknown): SummaryUsageDto {\n  const record = requiredRecord(value);\n  return {\n    ...parseTokenUsage(record),\n    session_count: requiredSafeInteger(record, "session_count"),\n  };\n}''',
    '''function parseUsage(value: unknown): SummaryUsageDto {\n  const record = requiredRecord(value);\n  const sessionCount = requiredSafeInteger(record, "session_count");\n  const healthRecord = requiredRecord(record.session_health);\n  const sessionHealth = {\n    total_sessions: requiredSafeInteger(healthRecord, "total_sessions"),\n    complete_sessions: requiredSafeInteger(healthRecord, "complete_sessions"),\n    incomplete_sessions: requiredSafeInteger(healthRecord, "incomplete_sessions"),\n    error_sessions: requiredSafeInteger(healthRecord, "error_sessions"),\n  };\n  const healthySessions = sessionHealth.complete_sessions + sessionHealth.incomplete_sessions;\n  const allSessions = healthySessions + sessionHealth.error_sessions;\n  if (\n    !Number.isSafeInteger(healthySessions) ||\n    !Number.isSafeInteger(allSessions) ||\n    healthySessions !== sessionCount ||\n    allSessions !== sessionHealth.total_sessions\n  ) {\n    throw new MiniUsageClientError("HTTP_ERROR", 200);\n  }\n  return {\n    ...parseTokenUsage(record),\n    session_count: sessionCount,\n    session_health: sessionHealth,\n  };\n}''',
    "summary health decoder",
)

replace_once(
    "frontend/src/data/miniUsageClient.ts",
    '''function parseSessionItem(value: unknown): SessionItemDto {\n  const record = requiredRecord(value);\n  const modelsValue = record.models_used;\n  if (!Array.isArray(modelsValue) || modelsValue.some((model) => typeof model !== "string")) {\n    throw new MiniUsageClientError("HTTP_ERROR", 200);\n  }\n  return {\n    root_session_id: requiredString(record, "root_session_id"),\n    title: nullableString(record, "title"),\n    project_name: nullableString(record, "project_name"),\n    project_path: nullableString(record, "project_path"),\n    last_activity_at_ms: requiredSafeInteger(record, "last_activity_at_ms"),\n    models_used: modelsValue,\n    subagent_count: requiredSafeInteger(record, "subagent_count"),\n    inclusive_usage: parseTokenUsage(record.inclusive_usage),\n    self_usage: parseTokenUsage(record.self_usage),\n    subagent_usage: parseTokenUsage(record.subagent_usage),\n  };\n}''',
    '''function parseSessionItem(value: unknown): SessionItemDto {\n  const record = requiredRecord(value);\n  const modelsValue = record.models_used;\n  if (!Array.isArray(modelsValue) || modelsValue.some((model) => typeof model !== "string")) {\n    throw new MiniUsageClientError("HTTP_ERROR", 200);\n  }\n  const dataStatus = requiredSessionDataStatus(record, "data_status");\n  const errorCode = nullableString(record, "error_code");\n  const inclusiveUsage = record.inclusive_usage === null ? null : parseTokenUsage(record.inclusive_usage);\n  const selfUsage = record.self_usage === null ? null : parseTokenUsage(record.self_usage);\n  const subagentUsage = record.subagent_usage === null ? null : parseTokenUsage(record.subagent_usage);\n  if (dataStatus === "error") {\n    if (inclusiveUsage !== null || selfUsage !== null || subagentUsage !== null || !errorCode) {\n      throw new MiniUsageClientError("HTTP_ERROR", 200);\n    }\n  } else if (inclusiveUsage === null || selfUsage === null || subagentUsage === null || errorCode !== null) {\n    throw new MiniUsageClientError("HTTP_ERROR", 200);\n  }\n  return {\n    root_session_id: requiredString(record, "root_session_id"),\n    title: nullableString(record, "title"),\n    project_name: nullableString(record, "project_name"),\n    project_path: nullableString(record, "project_path"),\n    last_activity_at_ms: requiredSafeInteger(record, "last_activity_at_ms"),\n    models_used: modelsValue,\n    subagent_count: requiredSafeInteger(record, "subagent_count"),\n    inclusive_usage: inclusiveUsage,\n    self_usage: selfUsage,\n    subagent_usage: subagentUsage,\n    data_status: dataStatus,\n    error_code: errorCode,\n  };\n}''',
    "session item health decoder",
)

replace_once(
    "frontend/src/data/miniUsageClient.ts",
    '''function parseSessionSortIndex(value: unknown): SessionSnapshotResponse["sort_index"][number] {\n  const record = requiredRecord(value);\n  return {\n    root_session_id: requiredString(record, "root_session_id"),\n    last_activity_at_ms: requiredSafeInteger(record, "last_activity_at_ms"),\n    project_sort_key: nullableString(record, "project_sort_key"),\n    model_sort_key: nullableString(record, "model_sort_key"),\n    total_tokens: requiredSafeInteger(record, "total_tokens"),\n    combined_total_tokens: requiredSafeInteger(record, "combined_total_tokens"),\n    cache_hit_rate: nullableRatio(record, "cache_hit_rate"),\n  };\n}''',
    '''function parseSessionSortIndex(value: unknown): SessionSnapshotResponse["sort_index"][number] {\n  const record = requiredRecord(value);\n  const dataStatus = requiredSessionDataStatus(record, "data_status");\n  const errorCode = nullableString(record, "error_code");\n  const totalTokens = nullableSafeInteger(record, "total_tokens");\n  const combinedTotalTokens = nullableSafeInteger(record, "combined_total_tokens");\n  if (dataStatus === "error") {\n    if (totalTokens !== null || combinedTotalTokens !== null || !errorCode) {\n      throw new MiniUsageClientError("HTTP_ERROR", 200);\n    }\n  } else if (totalTokens === null || combinedTotalTokens === null || errorCode !== null) {\n    throw new MiniUsageClientError("HTTP_ERROR", 200);\n  }\n  return {\n    root_session_id: requiredString(record, "root_session_id"),\n    last_activity_at_ms: requiredSafeInteger(record, "last_activity_at_ms"),\n    project_sort_key: nullableString(record, "project_sort_key"),\n    model_sort_key: nullableString(record, "model_sort_key"),\n    total_tokens: totalTokens,\n    combined_total_tokens: combinedTotalTokens,\n    cache_hit_rate: nullableRatio(record, "cache_hit_rate"),\n    data_status: dataStatus,\n    error_code: errorCode,\n  };\n}''',
    "session sort health decoder",
)

# ---------------- frontend fixture contract updates ----------------
replace_once(
    "frontend/src/dashboard/MetricGrid.test.tsx",
    '''  estimated_cost_status: "unknown" as const,\n  session_count: 0,\n};''',
    '''  estimated_cost_status: "unknown" as const,\n  session_count: 0,\n  session_health: {\n    total_sessions: 0,\n    complete_sessions: 0,\n    incomplete_sessions: 0,\n    error_sessions: 0,\n  },\n};''',
    "metric grid health fixture",
)

replace_once(
    "frontend/src/dashboard/DashboardPage.test.tsx",
    '''    estimated_cost_status: "unknown" as const,\n    session_count: 1,\n  },''',
    '''    estimated_cost_status: "unknown" as const,\n    session_count: 1,\n    session_health: {\n      total_sessions: 1,\n      complete_sessions: 1,\n      incomplete_sessions: 0,\n      error_sessions: 0,\n    },\n  },''',
    "dashboard page health fixture",
)

replace_once(
    "frontend/src/dashboard/useDashboardController.test.tsx",
    '''    estimated_cost_status: "unknown",\n    session_count: 1,\n  },''',
    '''    estimated_cost_status: "unknown",\n    session_count: 1,\n    session_health: {\n      total_sessions: 1,\n      complete_sessions: 1,\n      incomplete_sessions: 0,\n      error_sessions: 0,\n    },\n  },''',
    "dashboard controller health fixture",
)

replace_once(
    "frontend/src/dashboard/session/SessionTableRow.test.tsx",
    '''  subagent_usage: { ...usage, estimated_cost: null, estimated_cost_status: "unknown" },\n};''',
    '''  subagent_usage: { ...usage, estimated_cost: null, estimated_cost_status: "unknown" },\n  data_status: "complete",\n  error_code: null,\n};''',
    "session row health fixture",
)

for path, anchor in [
    ("frontend/src/dashboard/session/SessionDetailDrawer.test.tsx", '''  subagent_usage: usage,\n};'''),
    ("frontend/src/dashboard/session/SessionSection.test.tsx", '''  subagent_usage: usage,\n};'''),
]:
    replace_once(
        path,
        anchor,
        anchor.replace('};', '  data_status: "complete",\n  error_code: null,\n};'),
        f"{path} health fixture",
    )

replace_once(
    "frontend/src/dashboard/session/useSessionDetailController.test.tsx",
    '''  subagent_usage: {\n    input_tokens: 1,\n    cached_tokens: 0,\n    cache_write_tokens: null,\n    uncached_input_tokens: null,\n    output_tokens: 1,\n    reasoning_tokens: 1,\n    other_output_tokens: 0,\n    total_tokens: 2,\n    cache_hit_rate: null,\n    estimated_cost: null,\n    estimated_cost_status: "unknown",\n  },\n};''',
    '''  subagent_usage: {\n    input_tokens: 1,\n    cached_tokens: 0,\n    cache_write_tokens: null,\n    uncached_input_tokens: null,\n    output_tokens: 1,\n    reasoning_tokens: 1,\n    other_output_tokens: 0,\n    total_tokens: 2,\n    cache_hit_rate: null,\n    estimated_cost: null,\n    estimated_cost_status: "unknown",\n  },\n  data_status: "complete",\n  error_code: null,\n};''',
    "detail controller health fixture",
)
replace_once(
    "frontend/src/dashboard/session/useSessionDetailController.test.tsx",
    '''  const usage = { ...row.self_usage, total_tokens: total };''',
    '''  const usage = { ...row.self_usage!, total_tokens: total };''',
    "detail controller nullable usage assertion",
)

replace_once(
    "frontend/src/dashboard/session/useSessionTableController.test.tsx",
    '''    subagent_usage: usage,\n  };''',
    '''    subagent_usage: usage,\n    data_status: "complete",\n    error_code: null,\n  };''',
    "table controller row fixture",
)
replace_once(
    "frontend/src/dashboard/session/useSessionTableController.test.tsx",
    '''    cache_hit_rate: index % 6 === 0 ? null : (index % 10) / 10,\n  }));''',
    '''    cache_hit_rate: index % 6 === 0 ? null : (index % 10) / 10,\n    data_status: "complete" as const,\n    error_code: null,\n  }));''',
    "table controller first sort fixture",
)
replace_once(
    "frontend/src/dashboard/session/useSessionTableController.test.tsx",
    '''      cache_hit_rate: index === 198 ? null : (index % 10) / 10,\n    }));''',
    '''      cache_hit_rate: index === 198 ? null : (index % 10) / 10,\n      data_status: "complete" as const,\n      error_code: null,\n    }));''',
    "table controller second sort fixture",
)

replace_once(
    "frontend/src/data/miniUsageClient.test.ts",
    '''  estimated_cost_status: "unknown",\n  session_count: 1,\n};''',
    '''  estimated_cost_status: "unknown",\n  session_count: 1,\n  session_health: {\n    total_sessions: 1,\n    complete_sessions: 0,\n    incomplete_sessions: 1,\n    error_sessions: 0,\n  },\n};''',
    "client summary health fixture",
)
replace_once(
    "frontend/src/data/miniUsageClient.test.ts",
    '''  subagent_usage: sessionUsage,\n});''',
    '''  subagent_usage: sessionUsage,\n  data_status: "incomplete",\n  error_code: null,\n});''',
    "client session row health fixture",
)
replace_once(
    "frontend/src/data/miniUsageClient.test.ts",
    '''      combined_total_tokens: 30,\n      cache_hit_rate: 0.4,\n    };''',
    '''      combined_total_tokens: 30,\n      cache_hit_rate: 0.4,\n      data_status: "incomplete",\n      error_code: null,\n    };''',
    "client sort health fixture",
)

print("frontend health contract fixes applied")
