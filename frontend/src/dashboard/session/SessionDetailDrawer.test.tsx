import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionDetailResponse, SessionItemDto, UsageDto } from "../../data/types";
import type { SessionDetailControllerViewModel } from "./useSessionDetailController";
import { SessionDetailDrawer } from "./SessionDetailDrawer";

const usage: UsageDto = {
  input_tokens: 1_234,
  cached_tokens: 12,
  cache_write_tokens: null,
  uncached_input_tokens: 1_222,
  output_tokens: 567,
  reasoning_tokens: 8,
  other_output_tokens: 559,
  total_tokens: 1_801,
  cache_hit_rate: 0.01,
  estimated_cost: 0.5,
  estimated_cost_status: "complete",
};

const detail: SessionDetailResponse = {
  range: { key: "today", start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },
  data_revision: 3,
  root_session_id: "root-session-full-id",
  last_activity_at_ms: Date.UTC(2026, 7, 12, 8),
  main: {
    title: "A long Session title",
    thread_id: "root-session-full-id",
    root_session_id: "root-session-full-id",
    models_used: ["gpt-5", "o4-mini"],
    model_usage: [
      { model: "gpt-5", reasoning_effort: "high", usage },
      { model: "o4-mini", reasoning_effort: null, usage: { ...usage, total_tokens: 200, estimated_cost: 0.1 } },
    ],
    self_usage: { ...usage, total_tokens: 1_801, estimated_cost: 0.6 },
    subagent_count: 2,
    inclusive_usage: { ...usage, total_tokens: 3_601, estimated_cost: 1.2, estimated_cost_status: "partial" },
  },
  subagents: [
    {
      thread_id: "subagent-recent-full-id",
      parent_thread_id: "root-session-full-id",
      root_session_id: "root-session-full-id",
      title: "Recent subagent",
      model: "gpt-5",
      reasoning_effort: "high",
      reasoning_effort_mixed: false,
      last_activity_at_ms: Date.UTC(2026, 7, 12, 7),
      usage,
    },
    {
      thread_id: "subagent-old-full-id",
      parent_thread_id: "root-session-full-id",
      root_session_id: "root-session-full-id",
      title: "Old subagent",
      model: "o4-mini",
      reasoning_effort: null,
      reasoning_effort_mixed: true,
      last_activity_at_ms: Date.UTC(2026, 7, 11, 7),
      usage,
    },
  ],
};

const row: SessionItemDto = {
  root_session_id: detail.root_session_id,
  title: detail.main.title,
  project_name: "MiniUsage",
  project_path: "/work/MiniUsage",
  last_activity_at_ms: detail.last_activity_at_ms,
  models_used: detail.main.models_used,
  subagent_count: 2,
  inclusive_usage: detail.main.inclusive_usage,
  self_usage: detail.main.self_usage,
  subagent_usage: usage,
  data_status: "complete",
  error_code: null,
};

function view(overrides: Partial<SessionDetailControllerViewModel> = {}): SessionDetailControllerViewModel {
  return {
    open: true,
    selected_root_session_id: row.root_session_id,
    selected_row: row,
    detail,
    data_revision: 3,
    load_state: "ready",
    error_code: undefined,
    refresh_error_code: undefined,
    open_detail: vi.fn(),
    select_session: vi.fn(),
    close_detail: vi.fn(),
    refresh_detail: vi.fn(),
    retry_detail: vi.fn(),
    ...overrides,
  };
}

describe("SessionDetailDrawer v0.2.0", () => {
  it("renders the 480px receipt shell with exactly four summary rows", () => {
    render(<SessionDetailDrawer view={view()} timezone="Asia/Shanghai" />);

    const dialog = screen.getByRole("dialog", { name: "Session 详情" });
    expect(dialog).toHaveClass("w-[480px]", "max-[480px]:w-screen");
    expect(screen.getByRole("heading", { name: "A long Session title" })).toBeInTheDocument();
    expect(screen.getByText("root-session-full-id")).toBeInTheDocument();

    const summary = screen.getByRole("region", { name: "Session 合计" });
    const rows = summary.querySelectorAll("dl > div");
    expect(rows).toHaveLength(4);
    expect(summary).toHaveTextContent("Main Tokens");
    expect(summary).toHaveTextContent("Subagent Tokens");
    expect(summary).toHaveTextContent("Total Tokens");
    expect(summary).toHaveTextContent("Estimated Cost");
    expect(summary).toHaveTextContent("1,801");
    expect(summary).toHaveTextContent("1,800");
    expect(summary).toHaveTextContent("3,601");
    expect(summary).toHaveTextContent("$1.20");
    expect(screen.queryByText(/复制/)).not.toBeInTheDocument();
  });

  it("starts both accordion groups collapsed and enforces single-open within each group", () => {
    render(<SessionDetailDrawer view={view()} timezone="Asia/Shanghai" />);

    const mainFirst = screen.getByRole("button", { name: "gpt-5 (high)" });
    const mainSecond = screen.getByRole("button", { name: "o4-mini (—)" });
    const subFirst = screen.getByRole("button", { name: "Recent subagent" });
    const subSecond = screen.getByRole("button", { name: "Old subagent" });

    for (const trigger of [mainFirst, mainSecond, subFirst, subSecond]) {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    }

    fireEvent.click(mainFirst);
    expect(mainFirst).toHaveAttribute("aria-expanded", "true");
    expect(mainSecond).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(mainSecond);
    expect(mainFirst).toHaveAttribute("aria-expanded", "false");
    expect(mainSecond).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(subFirst);
    expect(subFirst).toHaveAttribute("aria-expanded", "true");
    expect(subSecond).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(subSecond);
    expect(subFirst).toHaveAttribute("aria-expanded", "false");
    expect(subSecond).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps Subagent trigger title-only and exposes identity metadata plus fixed receipt order after expansion", () => {
    render(<SessionDetailDrawer view={view()} timezone="Asia/Shanghai" />);

    const trigger = screen.getByRole("button", { name: "Recent subagent" });
    expect(trigger).not.toHaveTextContent("subagent-recent-full-id");
    expect(trigger).not.toHaveTextContent("gpt-5 (high)");

    fireEvent.click(trigger);
    const region = screen.getByRole("region", { name: "Recent subagent" });
    expect(region).toHaveTextContent("Thread ID");
    expect(region).toHaveTextContent("subagent-recent-full-id");
    expect(region).toHaveTextContent("Model");
    expect(region).toHaveTextContent("gpt-5 (high)");
    expect(region).toHaveTextContent("Last Active");

    const labels = Array.from(region.querySelectorAll("dl:last-child dt"), (node) => node.textContent);
    expect(labels).toEqual([
      "Total Tokens",
      "Input",
      "Output",
      "Reasoning",
      "Cache Read",
      "Cache Write",
      "Cache Hit Rate",
      "Estimated Cost",
    ]);
  });

  it("preserves rendered detail during refresh and reports refresh failure through toast", async () => {
    const refreshDetail = vi.fn();
    const rendered = render(
      <SessionDetailDrawer
        view={view({ load_state: "refreshing", refresh_detail: refreshDetail })}
        timezone="Asia/Shanghai"
      />,
    );

    expect(screen.getByRole("heading", { name: "A long Session title" })).toBeInTheDocument();
    expect(screen.queryByText("Session 详情加载失败")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新当前详情" })).toBeDisabled();

    rendered.rerender(
      <SessionDetailDrawer
        view={view({ refresh_error_code: "HTTP_ERROR", refresh_detail: refreshDetail })}
        timezone="Asia/Shanghai"
      />,
    );
    expect(screen.getByRole("heading", { name: "A long Session title" })).toBeInTheDocument();
    expect(await screen.findByText("详情更新失败")).toBeInTheDocument();
  });

  it("keeps loading/error fallbacks inside the open Drawer and wires retry/close", () => {
    const retry = vi.fn();
    const close = vi.fn();
    const loading = render(
      <SessionDetailDrawer view={view({ detail: null, load_state: "loading", close_detail: close })} timezone="Asia/Shanghai" />,
    );
    expect(screen.getByRole("dialog", { name: "Session 详情" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Session 详情加载中" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭 Session 详情" }));
    expect(close).toHaveBeenCalledTimes(1);
    loading.unmount();

    render(
      <SessionDetailDrawer
        view={view({ detail: null, load_state: "error", error_code: "HTTP_ERROR", retry_detail: retry })}
        timezone="Asia/Shanghai"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Session 详情加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
