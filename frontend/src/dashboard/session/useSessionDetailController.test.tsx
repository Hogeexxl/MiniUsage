import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MiniUsageClient } from "../../data/miniUsageClient";
import { createRevisionFeed, type RevisionEventSource } from "../../data/revisionFeed";
import { MiniUsageClientError, type DashboardFilters, type RangeKey, type SessionDetailResponse, type SessionItemDto } from "../../data/types";
import { useSessionDetailController } from "./useSessionDetailController";

const filters: DashboardFilters = { models: [], projects: [] };
const row: SessionItemDto = {
  root_session_id: "root-1",
  title: "Root",
  project_name: "MiniUsage",
  project_path: "/work/MiniUsage",
  last_activity_at_ms: 200,
  models_used: ["model-a"],
  subagent_count: 1,
  inclusive_usage: {
    input_tokens: 3,
    cached_tokens: 0,
    cache_write_tokens: null,
    uncached_input_tokens: null,
    output_tokens: 2,
    reasoning_tokens: 1,
    other_output_tokens: 1,
    total_tokens: 5,
    cache_hit_rate: null,
    estimated_cost: null,
    estimated_cost_status: "unknown",
  },
  self_usage: {
    input_tokens: 2,
    cached_tokens: 0,
    cache_write_tokens: null,
    uncached_input_tokens: null,
    output_tokens: 1,
    reasoning_tokens: 0,
    other_output_tokens: 1,
    total_tokens: 3,
    cache_hit_rate: null,
    estimated_cost: null,
    estimated_cost_status: "unknown",
  },
  subagent_usage: {
    input_tokens: 1,
    cached_tokens: 0,
    cache_write_tokens: null,
    uncached_input_tokens: null,
    output_tokens: 1,
    reasoning_tokens: 1,
    other_output_tokens: 0,
    total_tokens: 2,
    cache_hit_rate: null,
    estimated_cost: null,
    estimated_cost_status: "unknown",
  },
  data_status: "complete",
  error_code: null,
};

function detail(revision: number, total = revision, rootSessionId = "root-1"): SessionDetailResponse {
  const usage = { ...row.self_usage!, total_tokens: total };
  const secondModelUsage = { ...usage, total_tokens: total + 1 };
  return {
    range: { key: "today", start_ms: 1, end_ms: 3, timezone: "Asia/Shanghai" },
    data_revision: revision,
    root_session_id: rootSessionId,
    last_activity_at_ms: 200,
    main: {
      title: "Root",
      thread_id: rootSessionId,
      root_session_id: rootSessionId,
      models_used: ["model-a", "model-b"],
      model_usage: [
        { model: "model-a", reasoning_effort: null, usage },
        { model: "model-b", reasoning_effort: null, usage: secondModelUsage },
      ],
      self_usage: usage,
      subagent_count: 0,
      inclusive_usage: usage,
    },
    subagents: [],
  };
}

function clientWith(overrides: Partial<MiniUsageClient> = {}): MiniUsageClient {
  return {
    filterOptions: vi.fn(),
    summary: vi.fn(),
    modelDistribution: vi.fn(),
    projectDistribution: vi.fn(),
    skillsUsage: vi.fn(),
    getSessionSnapshot: vi.fn(),
    getSessionRows: vi.fn(),
    getSessionDetail: vi.fn(async ({ expected_data_revision, root_session_id }) => detail(expected_data_revision ?? 1, expected_data_revision ?? 1, root_session_id)),
    getStatus: vi.fn(),
    getRevision: vi.fn(async () => ({ data_revision: 1, status_revision: 1 })),
    refresh: vi.fn(),
    ...overrides,
  };
}

function sourceAndFeed(client: MiniUsageClient) {
  let source: RevisionEventSource | null = null;
  const feed = createRevisionFeed({
    client,
    eventSourceFactory: () => {
      const created: RevisionEventSource = { onerror: null, onmessage: null, close: vi.fn() };
      source = created;
      return created;
    },
  });
  return { feed, source: () => source };
}

afterEach(() => vi.useRealTimers());

describe("useSessionDetailController", () => {
  it("T-S08-001 covers lazy loading and one cache-key matrix across canonical filters, range, root, and revision", async () => {
    const client = clientWith();
    const { feed, source } = sourceAndFeed(client);
    const baseFilters: DashboardFilters = {
      models: ["model-b", "model-a", "model-b"],
      projects: [
        { kind: "unknown" },
        { kind: "projectless" },
        { kind: "project", project_path: "/z" },
        { kind: "project", project_path: "/a" },
        { kind: "projectless" },
        { kind: "unknown" },
      ],
    };
    const equivalentFilters: DashboardFilters = {
      models: ["model-a", "model-b", "model-a"],
      projects: [
        { kind: "project", project_path: "/a" },
        { kind: "unknown" },
        { kind: "projectless" },
        { kind: "project", project_path: "/z" },
        { kind: "unknown" },
      ],
    };
    let activeRange: RangeKey = "today";
    let activeFilters = baseFilters;
    const rowTwo = { ...row, root_session_id: "root-2" };
    const { result, rerender } = renderHook(() => useSessionDetailController(activeRange, activeFilters, { client, revisionFeed: feed, dataRevision: 1 }));
    expect(client.getSessionDetail).not.toHaveBeenCalled();

    await act(async () => result.current.open_detail(row));
    await waitFor(() => expect(result.current.load_state).toBe("ready"));
    expect(client.getSessionDetail).toHaveBeenCalledTimes(1);
    expect(client.getSessionDetail).toHaveBeenLastCalledWith(expect.objectContaining({
      range: "today",
      filters: {
        models: ["model-a", "model-b"],
        projects: [
          { kind: "project", project_path: "/a" },
          { kind: "project", project_path: "/z" },
          { kind: "projectless" },
          { kind: "unknown" },
        ],
      },
      root_session_id: "root-1",
      expected_data_revision: 1,
    }));
    expect(result.current.detail?.main.model_usage.map((model) => model.model)).toEqual(["model-a", "model-b"]);

    await act(async () => result.current.open_detail(row));
    expect(client.getSessionDetail).toHaveBeenCalledTimes(1);

    await act(async () => result.current.close_detail());
    activeFilters = equivalentFilters;
    rerender();
    await act(async () => result.current.open_detail(row));
    expect(client.getSessionDetail).toHaveBeenCalledTimes(1);

    await act(async () => result.current.close_detail());
    activeRange = "7d";
    rerender();
    await act(async () => result.current.open_detail(row));
    await waitFor(() => expect(client.getSessionDetail).toHaveBeenCalledTimes(2));
    expect(client.getSessionDetail).toHaveBeenLastCalledWith(expect.objectContaining({ range: "7d", root_session_id: "root-1" }));

    await act(async () => result.current.close_detail());
    activeRange = "today";
    activeFilters = { models: ["model-a"], projects: [] };
    rerender();
    await act(async () => result.current.open_detail(row));
    await waitFor(() => expect(client.getSessionDetail).toHaveBeenCalledTimes(3));
    expect(client.getSessionDetail).toHaveBeenLastCalledWith(expect.objectContaining({
      range: "today",
      filters: { models: ["model-a"], projects: [] },
      root_session_id: "root-1",
    }));

    await act(async () => result.current.close_detail());
    activeFilters = baseFilters;
    rerender();
    await act(async () => result.current.open_detail(rowTwo));
    await waitFor(() => expect(client.getSessionDetail).toHaveBeenCalledTimes(4));
    expect(client.getSessionDetail).toHaveBeenLastCalledWith(expect.objectContaining({ root_session_id: "root-2" }));

    await act(async () => result.current.close_detail());
    await act(async () => result.current.open_detail(row));
    expect(client.getSessionDetail).toHaveBeenCalledTimes(4);
    source()?.onmessage?.({ data: JSON.stringify({ data_revision: 2, status_revision: 2 }) } as MessageEvent<string>);
    await waitFor(() => expect(client.getSessionDetail).toHaveBeenCalledTimes(5));
    expect(client.getSessionDetail).toHaveBeenLastCalledWith(expect.objectContaining({ root_session_id: "root-1", expected_data_revision: 2 }));
    feed.dispose();
  });

  it("refreshes the open drawer on a higher revision and ignores the old response", async () => {
    let resolveOld!: (value: SessionDetailResponse) => void;
    let resolveNew!: (value: SessionDetailResponse) => void;
    const getSessionDetail = vi.fn(({ expected_data_revision }: Parameters<MiniUsageClient["getSessionDetail"]>[0]) => new Promise<SessionDetailResponse>((resolve) => {
      if (expected_data_revision === 1) resolveOld = resolve;
      else resolveNew = resolve;
    }));
    const client = clientWith({ getSessionDetail });
    const { feed, source } = sourceAndFeed(client);
    const { result } = renderHook(() => useSessionDetailController("today", filters, { client, revisionFeed: feed, dataRevision: 1 }));
    await act(async () => result.current.open_detail(row));
    await waitFor(() => expect(getSessionDetail).toHaveBeenCalledTimes(1));
    source()?.onmessage?.({ data: JSON.stringify({ data_revision: 2, status_revision: 2 }) } as MessageEvent<string>);
    await waitFor(() => expect(getSessionDetail).toHaveBeenCalledTimes(2));
    expect(result.current.load_state).toBe("loading");
    await act(async () => resolveOld(detail(1, 111)));
    expect(result.current.detail).toBeNull();
    await act(async () => resolveNew(detail(2, 222)));
    await waitFor(() => expect(result.current.detail?.data_revision).toBe(2));
    expect(result.current.detail?.main.self_usage.total_tokens).toBe(222);
    feed.dispose();
  });

  it("notifies the Session snapshot after a stale detail error", async () => {
    const onStaleRevision = vi.fn();
    const client = clientWith({ getSessionDetail: vi.fn(async () => { throw new MiniUsageClientError("STALE_DATA_REVISION", 409); }) });
    const { feed } = sourceAndFeed(client);
    const { result } = renderHook(() => useSessionDetailController("today", filters, { client, revisionFeed: feed, dataRevision: 1, onStaleRevision }));
    await act(async () => result.current.select_session(row));
    await waitFor(() => expect(result.current.load_state).toBe("error"));
    expect(onStaleRevision).toHaveBeenCalledTimes(1);
    feed.dispose();
  });
});
