import { act, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MiniUsageClient } from "../data/miniUsageClient";
import { MiniUsageClientError, type ApiErrorCode } from "../data/types";
import { ThemeProvider } from "../theme/ThemeProvider";
import { DashboardPage } from "./DashboardPage";

const summary = (range: "today" | "yesterday") => ({
  range: { key: range, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },
  data_revision: range === "today" ? 1 : 2,
  usage: {
    input_tokens: range === "today" ? 10 : 20,
    cached_tokens: 0,
    cache_write_tokens: 0,
    uncached_input_tokens: range === "today" ? 10 : 20,
    output_tokens: 2,
    reasoning_tokens: 0,
    other_output_tokens: 2,
    total_tokens: range === "today" ? 12 : 22,
    cache_hit_rate: 0.5,
    estimated_cost: null,
    estimated_cost_status: "unknown" as const,
    session_count: 1,
    cost_incomplete_session_count: 1,
    session_health: {
      total_sessions: 1,
      complete_sessions: 1,
      incomplete_sessions: 0,
      error_sessions: 0,
    },
  },
});

const status = {
  data_revision: 1,
  status_revision: 1,
  scan_state: "idle" as const,
  active_scan_id: null,
  last_finished_scan_id: null,
  last_finished_scan_result: null,
  followup: null,
  target_scan: null,
  last_scan_started_at_ms: null,
  last_scan_completed_at_ms: null,
  last_scan_failed_at_ms: null,
  last_scan_error_code: null,
  source_binding_status: "ready" as const,
};

const sessionSnapshot = {
  range: { key: "today" as const, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },
  data_revision: 1,
  total_items: 0,
  sort_index: [],
  items: [],
};

function fakeClient(overrides: Partial<MiniUsageClient> = {}): MiniUsageClient {
  return {
    filterOptions: vi.fn(async () => ({ data_revision: 1, models: [], projects: [] })),
    summary: vi.fn(async (range) => (range === "today" ? summary("today") : summary("yesterday"))),
    modelDistribution: vi.fn(async (range) => ({
      range: { key: range, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },
      data_revision: 1,
      items: [],
    })),
    projectDistribution: vi.fn(async (range) => ({
      range: { key: range, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },
      data_revision: 1,
      items: [],
    })),
    skillsUsage: vi.fn(async () => ({
      range: { key: "7d" as const, start_ms: 1, end_ms: 8, timezone: "Asia/Shanghai" },
      data_revision: 1,
      data_status: "ready" as const,
      days: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        start_ms: index + 1,
        end_ms: index + 2,
        total: 0,
        skills: [],
      })),
    })),
    getSessionSnapshot: vi.fn(async () => sessionSnapshot),
    getSessionRows: vi.fn(async ({ range }) => ({
      range: { ...sessionSnapshot.range, key: range },
      data_revision: 1,
      items: [],
    })),
    getSessionDetail: vi.fn(),
    getStatus: vi.fn(async () => status),
    getRevision: vi.fn(async () => ({ data_revision: 1, status_revision: 1 })),
    refresh: vi.fn(async () => ({ http_status: 202 as const, disposition: "started" as const, scan_id: "scan", status_revision: 2 })),
    ...overrides,
  };
}

function fakeEvents() {
  return {
    onerror: null as ((event: Event) => void) | null,
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderWithTheme(node: ReactNode) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function totalTokenCard() {
  return within(screen.getByLabelText("KPI 指标")).getByText("总 Token").parentElement;
}

describe("DashboardPage v0.2.0", () => {
  it("shows the last completed sync time with seconds", async () => {
    const completedAt = Date.UTC(2026, 0, 2, 3, 4, 5);
    const client = fakeClient({
      getStatus: vi.fn(async () => ({ ...status, last_scan_completed_at_ms: completedAt })),
    });
    renderWithTheme(<DashboardPage options={{ client, eventSourceFactory: () => fakeEvents() }} />);
    const date = new Date(completedAt);
    const expected = [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
    await waitFor(() => expect(screen.getByText(/上次同步：/)).toHaveTextContent(expected));
  });

  it("uses an em dash before a sync has completed", async () => {
    renderWithTheme(<DashboardPage options={{ client: fakeClient(), eventSourceFactory: () => fakeEvents() }} />);
    await waitFor(() => expect(screen.getByText(/上次同步：/)).toHaveTextContent("—"));
  });

  it("keeps one shared revision transport active across StrictMode remounts", async () => {
    let activeSources = 0;
    let maxActiveSources = 0;
    const factory = vi.fn(() => {
      const source = fakeEvents();
      const close = source.close;
      activeSources += 1;
      maxActiveSources = Math.max(maxActiveSources, activeSources);
      source.close = vi.fn(() => {
        close();
        activeSources -= 1;
      });
      return source;
    });
    const client = fakeClient();
    const view = renderWithTheme(
      <StrictMode>
        <DashboardPage options={{ client, eventSourceFactory: factory }} />
      </StrictMode>,
    );
    await waitFor(() => expect(totalTokenCard()).toHaveTextContent("12"));
    expect(maxActiveSources).toBe(1);
    expect(activeSources).toBe(1);
    view.unmount();
    expect(activeSources).toBe(0);
  });

  it("keeps a range snapshot and renders the redesigned sections without navigation", async () => {
    renderWithTheme(<DashboardPage options={{ client: fakeClient(), eventSourceFactory: () => fakeEvents() }} />);
    await waitFor(() => expect(totalTokenCard()).toHaveTextContent("12"));
    expect(screen.getByLabelText("KPI 指标").children).toHaveLength(4);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Session 记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /切换到浅色主题/ })).toBeInTheDocument();
  });

  it("maps a failed range load to fixed text without leaking the private error", async () => {
    const client = fakeClient({
      summary: vi.fn()
        .mockResolvedValueOnce(summary("today"))
        .mockRejectedValueOnce(new Error("private response body")),
    });
    renderWithTheme(<DashboardPage options={{ client, eventSourceFactory: () => fakeEvents() }} />);
    await waitFor(() => expect(totalTokenCard()).toHaveTextContent("12"));
    screen.getByRole("tab", { name: "昨天" }).click();
    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent("数据加载失败"));
    expect(screen.queryByText("private response body")).not.toBeInTheDocument();
    expect(screen.getByLabelText("KPI 加载中")).toBeInTheDocument();
  });

  it.each([
    [403, "FORBIDDEN", "无法发起同步"],
    [409, "SOURCE_CHANGED", "数据源已变化"],
    [500, "SCAN_START_FAILED", "同步失败"],
  ])("maps refresh HTTP errors %s/%s to %s", async (statusCode, code, message) => {
    const client = fakeClient({
      refresh: vi.fn(async () => {
        throw new MiniUsageClientError(code as ApiErrorCode, statusCode);
      }),
    });
    renderWithTheme(<DashboardPage options={{ client, eventSourceFactory: () => fakeEvents() }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "同步数据" })).toBeEnabled());
    screen.getByRole("button", { name: "同步数据" }).click();
    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0));
  });

  it("renders tracking failure separately and retries only status", async () => {
    let targetCalls = 0;
    const client = fakeClient({
      getStatus: vi.fn(async (target) => {
        if (!target) return status;
        targetCalls += 1;
        if (targetCalls === 1) throw new Error("raw response body");
        return {
          ...status,
          target_scan: {
            scan_id: target,
            state: "running" as const,
            started_status_revision: 2,
            terminal_status_revision: null,
            error_code: null,
          },
        };
      }),
    });
    renderWithTheme(<DashboardPage options={{ client, eventSourceFactory: () => fakeEvents() }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "同步数据" })).toBeEnabled());
    screen.getByRole("button", { name: "同步数据" }).click();
    await waitFor(() => expect(screen.getAllByText("同步状态获取失败").length).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "重试" }).click();
    await waitFor(() => expect(screen.getAllByText("同步中…").length).toBeGreaterThan(0));
    expect(client.refresh).toHaveBeenCalledTimes(1);
  });

  it("disables sync when status failed while Summary remains available, then recovers via retry", async () => {
    let statusAttempts = 0;
    const client = fakeClient({
      getStatus: vi.fn(async () => {
        statusAttempts += 1;
        if (statusAttempts === 1) throw new Error("status unavailable");
        return status;
      }),
      getRevision: vi.fn(async () => ({ data_revision: 0, status_revision: 0 })),
    });
    renderWithTheme(<DashboardPage options={{ client, eventSourceFactory: () => fakeEvents() }} />);
    const syncButton = screen.getByRole("button", { name: "同步数据" });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("数据加载失败"));
    expect(syncButton).toBeDisabled();
    expect(totalTokenCard()).toHaveTextContent("12");
    screen.getByRole("button", { name: "重试" }).click();
    await waitFor(() => expect(syncButton).toBeEnabled());
    expect(statusAttempts).toBe(2);
  });

  it.each([
    ["status then summary", ["status", "summary"] as const, false, true],
    ["summary then status", ["summary", "status"] as const, false, true],
    ["status then revision", ["status", "revision"] as const, true, false],
    ["revision then status", ["revision", "status"] as const, true, false],
  ])("keeps status-not-ready as the stable sync priority when dependencies fail (%s)", async (_name, failOrder, summarySucceeds, revisionSucceeds) => {
    const summaryRequest = deferred<ReturnType<typeof summary>>();
    const statusRequest = deferred<typeof status>();
    const revisionRequest = deferred<{ data_revision: number; status_revision: number }>();
    const client = fakeClient({
      summary: vi.fn(() => summaryRequest.promise),
      getStatus: vi.fn(() => statusRequest.promise),
      getRevision: vi.fn(() => revisionRequest.promise),
    });
    renderWithTheme(<DashboardPage options={{ client, eventSourceFactory: () => fakeEvents() }} />);

    await act(async () => {
      if (summarySucceeds) summaryRequest.resolve(summary("today"));
      if (revisionSucceeds) revisionRequest.resolve({ data_revision: 0, status_revision: 0 });
      await Promise.resolve();
    });
    for (const dependency of failOrder) {
      await act(async () => {
        if (dependency === "status") statusRequest.reject(new Error("status unavailable"));
        if (dependency === "summary") summaryRequest.reject(new Error("summary unavailable"));
        if (dependency === "revision") revisionRequest.reject(new Error("revision unavailable"));
        await Promise.resolve();
      });
    }

    const syncButton = screen.getByRole("button", { name: "同步数据" });
    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent("数据加载失败"));
    expect(syncButton).toBeDisabled();
    syncButton.click();
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it("enables sync after status retry while a Summary failure remains visible", async () => {
    let statusAttempts = 0;
    const client = fakeClient({
      summary: vi.fn(async () => {
        throw new Error("summary unavailable");
      }),
      getStatus: vi.fn(async () => {
        statusAttempts += 1;
        if (statusAttempts === 1) throw new Error("status unavailable");
        return status;
      }),
      getRevision: vi.fn(async () => ({ data_revision: 0, status_revision: 0 })),
    });
    renderWithTheme(<DashboardPage options={{ client, eventSourceFactory: () => fakeEvents() }} />);
    const syncButton = screen.getByRole("button", { name: "同步数据" });
    await waitFor(() => expect(syncButton).toBeDisabled());
    expect(screen.getByRole("alert")).toHaveTextContent("数据加载失败");
    screen.getByRole("button", { name: "重试" }).click();
    await waitFor(() => expect(syncButton).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("数据加载失败");
    syncButton.click();
    await waitFor(() => expect(client.refresh).toHaveBeenCalledTimes(1));
  });
});
