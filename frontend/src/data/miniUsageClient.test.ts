import { afterEach, describe, expect, it, vi } from "vitest";

import { miniUsageClient } from "./miniUsageClient";
import { MiniUsageClientError, type DashboardFilters } from "./types";

const emptyFilters: DashboardFilters = { models: [], projects: [] };
const range = { key: "today", start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" };
const usage = {
  input_tokens: 10,
  cached_tokens: 4,
  cache_write_tokens: null,
  uncached_input_tokens: null,
  output_tokens: 20,
  reasoning_tokens: 0,
  other_output_tokens: 20,
  total_tokens: 30,
  cache_hit_rate: null,
  estimated_cost: null,
  estimated_cost_status: "unknown",
  session_count: 1,
  cost_incomplete_session_count: 1,
  session_health: {
    total_sessions: 1,
    complete_sessions: 0,
    incomplete_sessions: 1,
    error_sessions: 0,
  },
};

const sessionUsage = {
  input_tokens: 10,
  cached_tokens: 4,
  cache_write_tokens: null,
  uncached_input_tokens: 6,
  output_tokens: 20,
  reasoning_tokens: 2,
  other_output_tokens: 18,
  total_tokens: 30,
  cache_hit_rate: 0.4,
  estimated_cost: null,
  estimated_cost_status: "unknown",
};

const sessionItem = (root_session_id = "root-1") => ({
  root_session_id,
  title: "A session",
  project_name: "MiniUsage",
  project_path: "/work/MiniUsage",
  last_activity_at_ms: 1_700_000_000_000,
  models_used: ["gpt-5"],
  subagent_count: 1,
  inclusive_usage: sessionUsage,
  self_usage: sessionUsage,
  subagent_usage: sessionUsage,
  data_status: "incomplete",
  error_code: null,
});

afterEach(() => vi.restoreAllMocks());

describe("miniUsageClient DTO seam", () => {
  it("t_s07_001 parses typed options and canonicalizes every summary filter shape", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data_revision: 7,
          models: ["gpt-5.6-sol", "gpt-5.6"],
          projects: [
            { kind: "project", project_name: "MiniUsage", project_path: "/work/MiniUsage" },
            { kind: "projectless" },
            { kind: "unknown" },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(miniUsageClient.filterOptions()).resolves.toEqual({
      data_revision: 7,
      models: ["gpt-5.6-sol", "gpt-5.6"],
      projects: [
        { kind: "project", project_name: "MiniUsage", project_path: "/work/MiniUsage" },
        { kind: "projectless" },
        { kind: "unknown" },
      ],
    });

    for (const invalid of [
      { data_revision: 1, models: [], projects: [{ kind: "projectless", project_path: "/fake" }] },
      { data_revision: 1, models: [], projects: [{ kind: "project", project_name: "MiniUsage" }] },
      { data_revision: 1, models: [""], projects: [] },
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(invalid), { status: 200 }));
      await expect(miniUsageClient.filterOptions()).rejects.toBeInstanceOf(MiniUsageClientError);
    }

    const filters: DashboardFilters = {
      models: ["gpt-b", "gpt-a", "gpt-b"],
      projects: [
        { kind: "unknown" as const },
        { kind: "projectless" as const },
        { kind: "project", project_path: "/a & b" },
        { kind: "project", project_path: "/a & b" },
      ],
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ range, data_revision: 1, usage }), { status: 200 }));
    await miniUsageClient.summary("today", filters);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/usage/summary?range=today&model=gpt-a&model=gpt-b&project_path=%2Fa+%26+b&include_projectless=1&include_unknown_project=1",
      expect.objectContaining({ method: "GET" }),
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ range, data_revision: 1, usage }), { status: 200 }));
    await miniUsageClient.summary("today", { models: [], projects: [] });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/usage/summary?range=today",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates summary/status/revision and keeps exact nullable fields through the public client", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ range, data_revision: 3, usage }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data_revision: 3,
            status_revision: 4,
            scan_state: "idle",
            active_scan_id: null,
            last_finished_scan_id: null,
            last_finished_scan_result: null,
            followup: null,
            target_scan: null,
            last_scan_started_at_ms: null,
            last_scan_completed_at_ms: null,
            last_scan_failed_at_ms: null,
            last_scan_error_code: null,
            source_binding_status: "ready",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data_revision: 3, status_revision: 4 }), { status: 200 }));
    await expect(miniUsageClient.summary("today", emptyFilters)).resolves.toEqual({
      range,
      data_revision: 3,
      usage,
    });
    const status = await miniUsageClient.getStatus();
    expect(status.source_binding_status).toBe("ready");
    await expect(miniUsageClient.getRevision()).resolves.toEqual({ data_revision: 3, status_revision: 4 });
  });

  it("rejects unsafe integers, invalid ratios, and legacy-field-only responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ range, data_revision: Number.MAX_SAFE_INTEGER + 1, usage }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ range, data_revision: 0, usage: { ...usage, cache_hit_rate: 1.1 } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            range,
            data_revision: 0,
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              total_tokens: 30,
              reasoning_output_tokens: 0,
              cached_input_tokens: 4,
              cache_write_input_tokens: null,
              cache_write_status: "unknown_missing",
              cache_tokens: null,
              cache_hit_rate: null,
              estimated_cost: null,
              session_count: 1,
            },
          }),
          { status: 200 },
        ),
      );
    await expect(miniUsageClient.summary("today", emptyFilters)).rejects.toBeInstanceOf(MiniUsageClientError);
    await expect(miniUsageClient.summary("today", emptyFilters)).rejects.toBeInstanceOf(MiniUsageClientError);
    await expect(miniUsageClient.summary("today", emptyFilters)).rejects.toBeInstanceOf(MiniUsageClientError);
  });

  it("preserves cache-write null and zero as distinct canonical values", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ range, data_revision: 0, usage }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            range,
            data_revision: 0,
            usage: { ...usage, cache_write_tokens: 0, uncached_input_tokens: 6 },
          }),
          { status: 200 },
        ),
      );
    await expect(miniUsageClient.summary("today", emptyFilters)).resolves.toMatchObject({ usage });
    await expect(miniUsageClient.summary("today", emptyFilters)).resolves.toMatchObject({
      usage: { cache_write_tokens: 0, uncached_input_tokens: 6 },
    });
  });

  it("uses relative API URLs, validates refresh acknowledgement, and maps errors without body text", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ http_status: 202, disposition: "started", scan_id: "scan", status_revision: 2 }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(miniUsageClient.refresh()).resolves.toMatchObject({ disposition: "started", http_status: 202 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/refresh",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "X-MiniUsage-Request": "1" }) }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "SOURCE_CHANGED", message: "secret path" } }), { status: 409 }),
    );
    const error = await miniUsageClient.getRevision().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(MiniUsageClientError);
    expect((error as MiniUsageClientError).code).toBe("SOURCE_CHANGED");
    expect(String(error)).not.toContain("secret path");
  });

  it("T-S04-001 parses snapshot/index, bounded repeated-ID rows, detail fields, and stale revision errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const sortIndex = {
      root_session_id: "root-1",
      last_activity_at_ms: 1_700_000_000_000,
      project_sort_key: "/work/MiniUsage",
      model_sort_key: "gpt-5",
      total_tokens: 30,
      combined_total_tokens: 30,
      combined_estimated_cost: null,
      cache_hit_rate: 0.4,
      data_status: "incomplete",
      error_code: null,
    };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ range, data_revision: 4, total_items: 1, sort_index: [sortIndex], items: [sessionItem()] }),
        { status: 200 },
      ),
    );
    await expect(miniUsageClient.getSessionSnapshot({ range: "today", filters: emptyFilters })).resolves.toEqual({
      range,
      data_revision: 4,
      total_items: 1,
      sort_index: [sortIndex],
      items: [sessionItem()],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/usage/sessions?range=today",
      expect.objectContaining({ method: "GET" }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ range, data_revision: 4, items: [sessionItem()] }), { status: 200 }),
    );
    await expect(
      miniUsageClient.getSessionRows({
        range: "today",
        filters: { models: ["gpt-b", "gpt-a", "gpt-b"], projects: [{ kind: "projectless" }] },
        root_session_ids: ["root-1", "root-1"],
        expected_data_revision: 4,
      }),
    ).resolves.toEqual({ range, data_revision: 4, items: [sessionItem()] });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/usage/session-rows?range=today&model=gpt-a&model=gpt-b&include_projectless=1&expected_data_revision=4&root_session_id=root-1",
      expect.objectContaining({ method: "GET" }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        range,
        data_revision: 4,
        root_session_id: "root-1",
        last_activity_at_ms: 1_700_000_000_000,
        main: {
          title: "A session",
          thread_id: "root-1",
          root_session_id: "root-1",
          models_used: ["gpt-5"],
          model_usage: [{ model: "gpt-5", reasoning_effort: "high", usage: sessionUsage }],
          self_usage: sessionUsage,
          subagent_count: 1,
          inclusive_usage: sessionUsage,
        },
        subagents: [{
          thread_id: "child-1",
          parent_thread_id: null,
          root_session_id: "root-1",
          title: null,
          model: "o4-mini",
          reasoning_effort: null,
          reasoning_effort_mixed: true,
          last_activity_at_ms: 1_700_000_000_000,
          usage: {
            ...sessionUsage,
            cache_write_tokens: 0,
            estimated_cost: 1.25,
            estimated_cost_status: "complete",
            reasoning_tokens: 9,
          },
        }],
      }), { status: 200 }),
    );
    await expect(miniUsageClient.getSessionDetail({ range: "today", filters: emptyFilters, root_session_id: "root-1", expected_data_revision: 4 })).resolves.toMatchObject({
      last_activity_at_ms: 1_700_000_000_000,
      main: { model_usage: [{ model: "gpt-5", reasoning_effort: "high" }], self_usage: sessionUsage, inclusive_usage: sessionUsage },
      subagents: [{ parent_thread_id: null, model: "o4-mini", reasoning_effort: null, reasoning_effort_mixed: true, usage: { reasoning_tokens: 9, cache_write_tokens: 0, estimated_cost: 1.25 } }],
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/usage/sessions/root-1/detail?range=today&expected_data_revision=4",
      expect.objectContaining({ method: "GET" }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "STALE_DATA_REVISION" } }), { status: 409 }),
    );
    await expect(miniUsageClient.getSessionRows({ range: "today", filters: emptyFilters, root_session_ids: ["root-1"], expected_data_revision: 4 })).rejects.toMatchObject({ code: "STALE_DATA_REVISION" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ range, data_revision: 4, items: Array.from({ length: 61 }, () => sessionItem()) }), { status: 200 }));
    await expect(miniUsageClient.getSessionRows({ range: "today", filters: emptyFilters, root_session_ids: ["root-1"] })).rejects.toBeInstanceOf(MiniUsageClientError);
    await expect(miniUsageClient.getSessionRows({ range: "today", filters: emptyFilters, root_session_ids: Array.from({ length: 61 }, (_, index) => `root-${index}`) })).rejects.toMatchObject({ code: "INVALID_SESSION_IDS" });
  });

  it("T-MU04-C03 validates cost status combinations across summary, session, and detail DTOs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const validCosts = [
      { estimated_cost: 1.25, estimated_cost_status: "complete" },
      { estimated_cost: 1.25, estimated_cost_status: "partial" },
      { estimated_cost: null, estimated_cost_status: "unknown" },
    ] as const;
    for (const cost of validCosts) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ range, data_revision: 0, usage: { ...usage, ...cost } }), { status: 200 }),
      );
      await expect(miniUsageClient.summary("today", emptyFilters)).resolves.toMatchObject({ usage: cost });
    }

    for (const invalidUsage of [
      { ...usage, estimated_cost_status: undefined },
      { ...usage, estimated_cost_status: "invalid" },
      { ...usage, estimated_cost: null, estimated_cost_status: "complete" },
      { ...usage, estimated_cost: null, estimated_cost_status: "partial" },
      { ...usage, estimated_cost: 1.25, estimated_cost_status: "unknown" },
    ]) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ range, data_revision: 0, usage: invalidUsage }), { status: 200 }),
      );
      await expect(miniUsageClient.summary("today", emptyFilters)).rejects.toBeInstanceOf(MiniUsageClientError);
    }

    const sortIndex = {
      root_session_id: "root-1",
      last_activity_at_ms: 1_700_000_000_000,
      project_sort_key: "/work/MiniUsage",
      model_sort_key: "gpt-5",
      total_tokens: 30,
      combined_total_tokens: 30,
      combined_estimated_cost: null,
      cache_hit_rate: 0.4,
      data_status: "incomplete",
      error_code: null,
    };
    const partialSessionUsage = { ...sessionUsage, estimated_cost: 1.25, estimated_cost_status: "partial" };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          range,
          data_revision: 0,
          total_items: 1,
          sort_index: [sortIndex],
          items: [{
            ...sessionItem("root-1"),
            inclusive_usage: partialSessionUsage,
            self_usage: partialSessionUsage,
            subagent_usage: partialSessionUsage,
          }],
        }),
        { status: 200 },
      ),
    );
    await expect(miniUsageClient.getSessionSnapshot({ range: "today", filters: emptyFilters })).resolves.toMatchObject({
      items: [{ inclusive_usage: partialSessionUsage, self_usage: partialSessionUsage, subagent_usage: partialSessionUsage }],
    });

    const detailUsage = { ...sessionUsage, estimated_cost: 1.25, estimated_cost_status: "partial" };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          range,
          data_revision: 0,
          root_session_id: "root-1",
          last_activity_at_ms: 1_700_000_000_000,
          main: {
            title: "A session",
            thread_id: "root-1",
            root_session_id: "root-1",
            models_used: ["gpt-5"],
            model_usage: [{ model: "gpt-5", reasoning_effort: "high", usage: detailUsage }],
            self_usage: detailUsage,
            subagent_count: 1,
            inclusive_usage: detailUsage,
          },
          subagents: [{
            thread_id: "child-1",
            parent_thread_id: null,
            root_session_id: "root-1",
            title: null,
            model: "o4-mini",
            reasoning_effort: null,
            reasoning_effort_mixed: true,
            last_activity_at_ms: 1_700_000_000_000,
            usage: detailUsage,
          }],
        }),
        { status: 200 },
      ),
    );
    await expect(
      miniUsageClient.getSessionDetail({ range: "today", filters: emptyFilters, root_session_id: "root-1" }),
    ).resolves.toMatchObject({
      main: {
        model_usage: [{ usage: detailUsage }],
        self_usage: detailUsage,
        inclusive_usage: detailUsage,
      },
      subagents: [{ usage: detailUsage }],
    });
  });

});
