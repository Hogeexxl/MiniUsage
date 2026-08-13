import {
  MiniUsageClientError,
  type ApiErrorCode,
  type FollowupDto,
  type RangeDto,
  type RangeKey,
  type RefreshAccepted,
  type RevisionResponse,
  type SessionDetailResponse,
  type SessionItemDto,
  type SessionRowsResponse,
  type SessionSnapshotResponse,
  type SessionSortField,
  type SessionSortOrder,
  type StatusResponse,
  type SummaryResponse,
  type SummaryUsageDto,
  type UsageDto,
  type TargetScanDto,
  type DashboardFilters,
  type FilterOptionsResponse,
  type ProjectFilterOption,
  type ProjectSelection,
  type EstimatedCostStatus,
  type UpdateStatusResponse,
} from "./types";

const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;
const API_ERROR_CODES = new Set<ApiErrorCode>([
  "INVALID_RANGE",
  "INVALID_FILTER",
  "INVALID_SESSION_IDS",
  "INVALID_SCAN_ID",
  "SCAN_NOT_FOUND",
  "STALE_DATA_REVISION",
  "FORBIDDEN",
  "FORBIDDEN_HOST",
  "FORBIDDEN_ORIGIN",
  "NOT_FOUND",
  "SOURCE_CHANGED",
  "SCANNER_UNAVAILABLE",
  "LOCAL_TIME_UNAVAILABLE",
  "QUERY_OVERFLOW",
  "DATABASE_BUSY",
  "QUERY_FAILED",
  "SCAN_START_FAILED",
  "SCAN_ENQUEUE_FAILED",
  "UPDATE_CHECK_FAILED",
  "UPDATE_NOT_AVAILABLE",
  "UPDATE_BROWSER_OPEN_FAILED",
  "INTERNAL_ERROR",
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return value;
}

function requiredString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return value;
}

function nullableString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return value;
}

function requiredBoolean(record: JsonRecord, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return value;
}

function requiredSafeInteger(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > SAFE_INTEGER_MAX) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return value;
}

function nullableSafeInteger(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > SAFE_INTEGER_MAX) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return value;
}

function nullableRatio(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return value;
}

function nullableCost(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return value;
}

function requiredEstimatedCostStatus(record: JsonRecord, key: string): EstimatedCostStatus {
  const value = record[key];
  if (value === "complete" || value === "partial" || value === "unknown") {
    return value;
  }
  throw new MiniUsageClientError("HTTP_ERROR", 200);
}

function parseRange(value: unknown): RangeDto {
  const record = requiredRecord(value);
  const key = requiredString(record, "key");
  if (!["today", "yesterday", "week", "month", "year"].includes(key)) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    key: key as RangeKey,
    start_ms: requiredSafeInteger(record, "start_ms"),
    end_ms: requiredSafeInteger(record, "end_ms"),
    timezone: requiredString(record, "timezone"),
  };
}

function parseTokenUsage(value: unknown, requireNullCost = false): UsageDto {
  const record = requiredRecord(value);
  const estimatedCost = nullableCost(record, "estimated_cost");
  const estimatedCostStatus = requiredEstimatedCostStatus(record, "estimated_cost_status");
  if (
    (estimatedCost === null && estimatedCostStatus !== "unknown") ||
    (estimatedCost !== null && estimatedCostStatus === "unknown")
  ) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  if (requireNullCost && estimatedCost !== null) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    input_tokens: requiredSafeInteger(record, "input_tokens"),
    cached_tokens: requiredSafeInteger(record, "cached_tokens"),
    cache_write_tokens: nullableSafeInteger(record, "cache_write_tokens"),
    uncached_input_tokens: nullableSafeInteger(record, "uncached_input_tokens"),
    output_tokens: requiredSafeInteger(record, "output_tokens"),
    reasoning_tokens: requiredSafeInteger(record, "reasoning_tokens"),
    other_output_tokens: requiredSafeInteger(record, "other_output_tokens"),
    total_tokens: requiredSafeInteger(record, "total_tokens"),
    cache_hit_rate: nullableRatio(record, "cache_hit_rate"),
    estimated_cost: estimatedCost,
    estimated_cost_status: estimatedCostStatus,
  };
}

function parseUsage(value: unknown): SummaryUsageDto {
  const record = requiredRecord(value);
  return {
    ...parseTokenUsage(record),
    session_count: requiredSafeInteger(record, "session_count"),
  };
}

function parseSummary(value: unknown): SummaryResponse {
  const record = requiredRecord(value);
  return {
    range: parseRange(record.range),
    data_revision: requiredSafeInteger(record, "data_revision"),
    usage: parseUsage(record.usage),
  };
}

function hasOnlyKeys(record: JsonRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function parseProjectFilterOption(value: unknown): ProjectFilterOption {
  const record = requiredRecord(value);
  const kind = requiredString(record, "kind");
  if (kind === "project") {
    if (!hasOnlyKeys(record, ["kind", "project_name", "project_path"])) {
      throw new MiniUsageClientError("HTTP_ERROR", 200);
    }
    return {
      kind,
      project_name: requiredString(record, "project_name"),
      project_path: requiredString(record, "project_path"),
    };
  }
  if (kind === "projectless" || kind === "unknown") {
    if (!hasOnlyKeys(record, ["kind"])) throw new MiniUsageClientError("HTTP_ERROR", 200);
    return { kind };
  }
  throw new MiniUsageClientError("HTTP_ERROR", 200);
}

function parseFilterOptions(value: unknown): FilterOptionsResponse {
  const record = requiredRecord(value);
  if (!hasOnlyKeys(record, ["data_revision", "models", "projects"])) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  const modelsValue = record.models;
  const projectsValue = record.projects;
  if (
    !Array.isArray(modelsValue) ||
    modelsValue.some(
      (model) =>
        typeof model !== "string" ||
        model.length === 0 ||
        [...model].some((character) => character.charCodeAt(0) < 32),
    ) ||
    !Array.isArray(projectsValue)
  ) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    data_revision: requiredSafeInteger(record, "data_revision"),
    models: [...modelsValue],
    projects: projectsValue.map(parseProjectFilterOption),
  };
}

function parseSessionItem(value: unknown): SessionItemDto {
  const record = requiredRecord(value);
  const modelsValue = record.models_used;
  if (!Array.isArray(modelsValue) || modelsValue.some((model) => typeof model !== "string")) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    root_session_id: requiredString(record, "root_session_id"),
    title: nullableString(record, "title"),
    project_name: nullableString(record, "project_name"),
    project_path: nullableString(record, "project_path"),
    last_activity_at_ms: requiredSafeInteger(record, "last_activity_at_ms"),
    models_used: modelsValue,
    subagent_count: requiredSafeInteger(record, "subagent_count"),
    inclusive_usage: parseTokenUsage(record.inclusive_usage),
    self_usage: parseTokenUsage(record.self_usage),
    subagent_usage: parseTokenUsage(record.subagent_usage),
  };
}

function parseSessionSortIndex(value: unknown): SessionSnapshotResponse["sort_index"][number] {
  const record = requiredRecord(value);
  return {
    root_session_id: requiredString(record, "root_session_id"),
    last_activity_at_ms: requiredSafeInteger(record, "last_activity_at_ms"),
    project_sort_key: nullableString(record, "project_sort_key"),
    model_sort_key: nullableString(record, "model_sort_key"),
    total_tokens: requiredSafeInteger(record, "total_tokens"),
    combined_total_tokens: requiredSafeInteger(record, "combined_total_tokens"),
    cache_hit_rate: nullableRatio(record, "cache_hit_rate"),
  };
}

function parseSessionSnapshot(value: unknown): SessionSnapshotResponse {
  const record = requiredRecord(value);
  const itemsValue = record.items;
  const sortIndexValue = record.sort_index;
  if (!Array.isArray(itemsValue) || !Array.isArray(sortIndexValue) || itemsValue.length > 60) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  const items = itemsValue.map(parseSessionItem);
  const sortIndex = sortIndexValue.map(parseSessionSortIndex);
  const indexIds = new Set(sortIndex.map((item) => item.root_session_id));
  const itemIds = new Set(items.map((item) => item.root_session_id));
  if (indexIds.size !== sortIndex.length || itemIds.size !== items.length || items.some((item) => !indexIds.has(item.root_session_id))) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  const totalItems = requiredSafeInteger(record, "total_items");
  if (totalItems !== sortIndex.length) throw new MiniUsageClientError("HTTP_ERROR", 200);
  return {
    range: parseRange(record.range),
    data_revision: requiredSafeInteger(record, "data_revision"),
    total_items: totalItems,
    sort_index: sortIndex,
    items,
  };
}

function parseSessionRows(value: unknown): SessionRowsResponse {
  const record = requiredRecord(value);
  const itemsValue = record.items;
  if (!Array.isArray(itemsValue) || itemsValue.length > 60) throw new MiniUsageClientError("HTTP_ERROR", 200);
  const items = itemsValue.map(parseSessionItem);
  const ids = new Set(items.map((item) => item.root_session_id));
  if (ids.size !== items.length) throw new MiniUsageClientError("HTTP_ERROR", 200);
  return {
    range: parseRange(record.range),
    data_revision: requiredSafeInteger(record, "data_revision"),
    items,
  };
}

function parseMainModelUsage(value: unknown): SessionDetailResponse["main"]["model_usage"][number] {
  const record = requiredRecord(value);
  return {
    model: requiredString(record, "model"),
    reasoning_effort: nullableString(record, "reasoning_effort"),
    usage: parseTokenUsage(record.usage),
  };
}

function parseSessionDetail(value: unknown): SessionDetailResponse {
  const record = requiredRecord(value);
  const mainRecord = requiredRecord(record.main);
  const modelUsageValue = mainRecord.model_usage;
  const subagentsValue = record.subagents;
  if (!Array.isArray(modelUsageValue) || !Array.isArray(subagentsValue)) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  const modelsUsed = mainRecord.models_used;
  if (!Array.isArray(modelsUsed) || modelsUsed.some((model) => typeof model !== "string" || model.length === 0)) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    range: parseRange(record.range),
    data_revision: requiredSafeInteger(record, "data_revision"),
    root_session_id: requiredString(record, "root_session_id"),
    last_activity_at_ms: requiredSafeInteger(record, "last_activity_at_ms"),
    main: {
      title: nullableString(mainRecord, "title"),
      thread_id: requiredString(mainRecord, "thread_id"),
      root_session_id: requiredString(mainRecord, "root_session_id"),
      models_used: modelsUsed,
      model_usage: modelUsageValue.map(parseMainModelUsage),
      self_usage: parseTokenUsage(mainRecord.self_usage),
      subagent_count: requiredSafeInteger(mainRecord, "subagent_count"),
      inclusive_usage: parseTokenUsage(mainRecord.inclusive_usage),
    },
    subagents: subagentsValue.map((value) => {
      const subagent = requiredRecord(value);
      return {
        thread_id: requiredString(subagent, "thread_id"),
        parent_thread_id: nullableString(subagent, "parent_thread_id"),
        root_session_id: requiredString(subagent, "root_session_id"),
        title: nullableString(subagent, "title"),
        model: requiredString(subagent, "model"),
        reasoning_effort: nullableString(subagent, "reasoning_effort"),
        reasoning_effort_mixed: requiredBoolean(subagent, "reasoning_effort_mixed"),
        last_activity_at_ms: requiredSafeInteger(subagent, "last_activity_at_ms"),
        usage: parseTokenUsage(subagent.usage),
      };
    }),
  };
}

function parseRevision(value: unknown): RevisionResponse {
  const record = requiredRecord(value);
  return {
    data_revision: requiredSafeInteger(record, "data_revision"),
    status_revision: requiredSafeInteger(record, "status_revision"),
  };
}

function parseFollowup(value: unknown): FollowupDto {
  const record = requiredRecord(value);
  const state = requiredString(record, "state");
  if (state !== "queued" && state !== "start_failed") {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    scan_id: requiredString(record, "scan_id"),
    state,
    enqueued_status_revision: requiredSafeInteger(record, "enqueued_status_revision"),
    requested_at_ms: requiredSafeInteger(record, "requested_at_ms"),
    error_code: nullableString(record, "error_code"),
  };
}

function parseTarget(value: unknown): TargetScanDto {
  const record = requiredRecord(value);
  const state = requiredString(record, "state");
  if (!["queued", "running", "completed", "failed", "start_failed"].includes(state)) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    scan_id: requiredString(record, "scan_id"),
    state: state as TargetScanDto["state"],
    started_status_revision: nullableSafeInteger(record, "started_status_revision"),
    terminal_status_revision: nullableSafeInteger(record, "terminal_status_revision"),
    error_code: nullableString(record, "error_code"),
  };
}

function parseStatus(value: unknown): StatusResponse {
  const record = requiredRecord(value);
  const scanState = requiredString(record, "scan_state");
  if (!["startup", "running", "idle", "failed", "source_changed"].includes(scanState)) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  const binding = requiredString(record, "source_binding_status");
  if (!["unbound", "ready", "source_changed"].includes(binding)) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  const followupValue = record.followup;
  const targetValue = record.target_scan;
  return {
    data_revision: requiredSafeInteger(record, "data_revision"),
    status_revision: requiredSafeInteger(record, "status_revision"),
    scan_state: scanState as StatusResponse["scan_state"],
    active_scan_id: nullableString(record, "active_scan_id"),
    last_finished_scan_id: nullableString(record, "last_finished_scan_id"),
    last_finished_scan_result: nullableString(record, "last_finished_scan_result"),
    followup: followupValue === null ? null : parseFollowup(followupValue),
    target_scan: targetValue === null ? null : parseTarget(targetValue),
    last_scan_started_at_ms: nullableSafeInteger(record, "last_scan_started_at_ms"),
    last_scan_completed_at_ms: nullableSafeInteger(record, "last_scan_completed_at_ms"),
    last_scan_failed_at_ms: nullableSafeInteger(record, "last_scan_failed_at_ms"),
    last_scan_error_code: nullableString(record, "last_scan_error_code"),
    source_binding_status: binding as StatusResponse["source_binding_status"],
  };
}

function parseUpdateStatus(value: unknown): UpdateStatusResponse {
  const record = requiredRecord(value);
  if (
    !hasOnlyKeys(record, [
      "current_version",
      "latest_version",
      "update_available",
      "release_url",
      "last_checked_at_ms",
      "checking",
    ])
  ) {
    throw new MiniUsageClientError("HTTP_ERROR", 200);
  }
  return {
    current_version: requiredString(record, "current_version"),
    latest_version: nullableString(record, "latest_version"),
    update_available: requiredBoolean(record, "update_available"),
    release_url: nullableString(record, "release_url"),
    last_checked_at_ms: nullableSafeInteger(record, "last_checked_at_ms"),
    checking: requiredBoolean(record, "checking"),
  };
}

function parseRefresh(value: unknown, status: number): RefreshAccepted {
  const record = requiredRecord(value);
  const bodyStatus = record.http_status;
  if (bodyStatus !== status) {
    throw new MiniUsageClientError("HTTP_ERROR", status);
  }
  const disposition = requiredString(record, "disposition");
  if (disposition !== "started" && disposition !== "coalesced") {
    throw new MiniUsageClientError("HTTP_ERROR", status);
  }
  if (status !== 200 && status !== 202) {
    throw new MiniUsageClientError("HTTP_ERROR", status);
  }
  if ((status === 202 && disposition !== "started") || (status === 200 && disposition !== "coalesced")) {
    throw new MiniUsageClientError("HTTP_ERROR", status);
  }
  return {
    http_status: status,
    disposition,
    scan_id: requiredString(record, "scan_id"),
    status_revision: requiredSafeInteger(record, "status_revision"),
  };
}

async function parseError(response: Response): Promise<MiniUsageClientError> {
  let code: ApiErrorCode = "HTTP_ERROR";
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error) && typeof body.error.code === "string") {
      const candidate = body.error.code as ApiErrorCode;
      if (API_ERROR_CODES.has(candidate)) code = candidate;
    }
  } catch {
    // Keep the fixed generic error when a server response is not JSON.
  }
  return new MiniUsageClientError(code, response.status);
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      signal,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new MiniUsageClientError("HTTP_ERROR", 0);
  }
  if (!response.ok) throw await parseError(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MiniUsageClientError("HTTP_ERROR", response.status);
  }
  return body as T;
}

export type MiniUsageClient = {
  filterOptions(signal?: AbortSignal): Promise<FilterOptionsResponse>;
  summary(range: RangeKey, filters: DashboardFilters, signal?: AbortSignal): Promise<SummaryResponse>;
  getSessionSnapshot(request: {
    range: RangeKey;
    filters: DashboardFilters;
    seed_sort_by?: SessionSortField;
    seed_sort_order?: SessionSortOrder;
    signal?: AbortSignal;
  }): Promise<SessionSnapshotResponse>;
  getSessionRows(request: {
    range: RangeKey;
    filters: DashboardFilters;
    root_session_ids: string[];
    expected_data_revision?: number;
    signal?: AbortSignal;
  }): Promise<SessionRowsResponse>;
  getSessionDetail(request: {
    range: RangeKey;
    filters: DashboardFilters;
    root_session_id: string;
    expected_data_revision?: number;
    signal?: AbortSignal;
  }): Promise<SessionDetailResponse>;
  getStatus(targetScanId?: string, signal?: AbortSignal): Promise<StatusResponse>;
  getRevision(signal?: AbortSignal): Promise<RevisionResponse>;
  refresh(signal?: AbortSignal): Promise<RefreshAccepted>;
  getUpdateStatus?(signal?: AbortSignal): Promise<UpdateStatusResponse>;
  checkUpdate?(signal?: AbortSignal): Promise<UpdateStatusResponse>;
  openRelease?(signal?: AbortSignal): Promise<void>;
};

export type MiniUsageUpdateClient = {
  getUpdateStatus(signal?: AbortSignal): Promise<UpdateStatusResponse>;
  checkUpdate(signal?: AbortSignal): Promise<UpdateStatusResponse>;
  openRelease(signal?: AbortSignal): Promise<void>;
};

function sortedUnique(values: readonly string[]): string[] {
  for (const value of values) {
    if (value.length === 0 || [...value].some((character) => character.charCodeAt(0) < 32)) {
      throw new MiniUsageClientError("INVALID_FILTER", 0);
    }
  }
  return [...new Set(values)].sort();
}

function canonicalProjectSelections(projects: readonly ProjectSelection[]): {
  projectPaths: string[];
  includeProjectless: boolean;
  includeUnknown: boolean;
} {
  const projectPaths = new Set<string>();
  let includeProjectless = false;
  let includeUnknown = false;
  for (const project of projects) {
    if (project.kind === "project") {
      if (project.project_path.length === 0 || [...project.project_path].some((character) => character.charCodeAt(0) < 32)) {
        throw new MiniUsageClientError("INVALID_FILTER", 0);
      }
      projectPaths.add(project.project_path);
    } else if (project.kind === "projectless") {
      includeProjectless = true;
    } else if (project.kind === "unknown") {
      includeUnknown = true;
    } else {
      throw new MiniUsageClientError("INVALID_FILTER", 0);
    }
  }
  return {
    projectPaths: [...projectPaths].sort(),
    includeProjectless,
    includeUnknown,
  };
}

export function canonicalDashboardFilters(filters: DashboardFilters): DashboardFilters {
  const projects = canonicalProjectSelections(filters.projects);
  return {
    models: sortedUnique(filters.models),
    projects: [
      ...projects.projectPaths.map((project_path) => ({ kind: "project" as const, project_path })),
      ...(projects.includeProjectless ? [{ kind: "projectless" as const }] : []),
      ...(projects.includeUnknown ? [{ kind: "unknown" as const }] : []),
    ],
  };
}

export function dashboardQueryKey(range: RangeKey, filters: DashboardFilters): string {
  const canonical = canonicalDashboardFilters(filters);
  return JSON.stringify([range, canonical.models, canonical.projects]);
}

function sessionParams(range: RangeKey, filters: DashboardFilters): URLSearchParams {
  const canonical = canonicalDashboardFilters(filters);
  const params = new URLSearchParams({ range });
  for (const model of canonical.models) params.append("model", model);
  for (const project of canonical.projects) {
    if (project.kind === "project") params.append("project_path", project.project_path);
    if (project.kind === "projectless") params.append("include_projectless", "1");
    if (project.kind === "unknown") params.append("include_unknown_project", "1");
  }
  return params;
}

function canonicalSessionIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (id.length === 0 || [...id].some((character) => character.charCodeAt(0) < 32)) {
      throw new MiniUsageClientError("INVALID_SESSION_IDS", 0);
    }
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

export const miniUsageClient: MiniUsageClient & MiniUsageUpdateClient = {
  async filterOptions(signal) {
    const body = await getJson<unknown>("/api/usage/filter-options", signal);
    return parseFilterOptions(body);
  },
  async summary(range, filters, signal) {
    const canonical = canonicalDashboardFilters(filters);
    const params = new URLSearchParams();
    params.append("range", range);
    for (const model of canonical.models) params.append("model", model);
    for (const project of canonical.projects) {
      if (project.kind === "project") params.append("project_path", project.project_path);
      if (project.kind === "projectless") params.append("include_projectless", "1");
      if (project.kind === "unknown") params.append("include_unknown_project", "1");
    }
    const body = await getJson<unknown>(`/api/usage/summary?${params.toString()}`, signal);
    return parseSummary(body);
  },
  async getSessionSnapshot({ range, filters, seed_sort_by, seed_sort_order, signal }) {
    const params = sessionParams(range, filters);
    if (seed_sort_by) params.append("seed_sort_by", seed_sort_by);
    if (seed_sort_order) params.append("seed_sort_order", seed_sort_order);
    const body = await getJson<unknown>(`/api/usage/sessions?${params.toString()}`, signal);
    const response = parseSessionSnapshot(body);
    if (response.range.key !== range) throw new MiniUsageClientError("HTTP_ERROR", 200);
    return response;
  },
  async getSessionRows({ range, filters, root_session_ids, expected_data_revision, signal }) {
    const ids = canonicalSessionIds(root_session_ids);
    if (ids.length === 0 || ids.length > 60) throw new MiniUsageClientError("INVALID_SESSION_IDS", 0);
    const params = sessionParams(range, filters);
    if (expected_data_revision !== undefined) params.append("expected_data_revision", String(expected_data_revision));
    for (const id of ids) params.append("root_session_id", id);
    const body = await getJson<unknown>(`/api/usage/session-rows?${params.toString()}`, signal);
    const response = parseSessionRows(body);
    if (response.range.key !== range || response.items.some((item) => !ids.includes(item.root_session_id))) {
      throw new MiniUsageClientError("HTTP_ERROR", 200);
    }
    return response;
  },
  async getSessionDetail({ range, filters, root_session_id, expected_data_revision, signal }) {
    const ids = canonicalSessionIds([root_session_id]);
    if (ids.length !== 1) throw new MiniUsageClientError("INVALID_SESSION_IDS", 0);
    const params = sessionParams(range, filters);
    if (expected_data_revision !== undefined) params.append("expected_data_revision", String(expected_data_revision));
    const body = await getJson<unknown>(
      `/api/usage/sessions/${encodeURIComponent(root_session_id)}/detail?${params.toString()}`,
      signal,
    );
    const response = parseSessionDetail(body);
    if (response.range.key !== range || response.root_session_id !== root_session_id) {
      throw new MiniUsageClientError("HTTP_ERROR", 200);
    }
    return response;
  },
  async getStatus(targetScanId, signal) {
    const query = targetScanId ? `?target_scan_id=${encodeURIComponent(targetScanId)}` : "";
    const body = await getJson<unknown>(`/api/status${query}`, signal);
    return parseStatus(body);
  },
  async getRevision(signal) {
    const body = await getJson<unknown>("/api/revision", signal);
    return parseRevision(body);
  },
  async refresh(signal) {
    let response: Response;
    try {
      response = await fetch("/api/refresh", {
        method: "POST",
        signal,
        headers: {
          Accept: "application/json",
          "X-MiniUsage-Request": "1",
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new MiniUsageClientError("HTTP_ERROR", 0);
    }
    if (!response.ok) throw await parseError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MiniUsageClientError("HTTP_ERROR", response.status);
    }
    return parseRefresh(body, response.status);
  },
  async getUpdateStatus(signal) {
    const body = await getJson<unknown>("/api/update/status", signal);
    return parseUpdateStatus(body);
  },
  async checkUpdate(signal) {
    let response: Response;
    try {
      response = await fetch("/api/update/check", {
        method: "POST",
        signal,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-MiniUsage-Request": "1",
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new MiniUsageClientError("HTTP_ERROR", 0);
    }
    if (!response.ok) throw await parseError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MiniUsageClientError("HTTP_ERROR", response.status);
    }
    return parseUpdateStatus(body);
  },
  async openRelease(signal) {
    let response: Response;
    try {
      response = await fetch("/api/update/open-release", {
        method: "POST",
        signal,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-MiniUsage-Request": "1",
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new MiniUsageClientError("HTTP_ERROR", 0);
    }
    if (!response.ok) throw await parseError(response);
  },
};
