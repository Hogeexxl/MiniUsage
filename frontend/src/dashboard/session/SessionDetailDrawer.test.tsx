import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionDetailResponse, SessionItemDto } from "../../data/types";
import f01SharedFixture from "../../test-fixtures/t_mu03_f01_real_structure.json";
import type { SessionDetailControllerViewModel } from "./useSessionDetailController";
import { SessionDetailDrawer } from "./SessionDetailDrawer";

const usage = {
  input_tokens: 1_234,
  cached_tokens: 12,
  cache_write_tokens: null,
  uncached_input_tokens: 1_222,
  output_tokens: 567,
  reasoning_tokens: 8,
  other_output_tokens: 559,
  total_tokens: 1_801,
  cache_hit_rate: 0.01,
  estimated_cost: null,
  estimated_cost_status: "unknown" as const,
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
      { model: "o4-mini", reasoning_effort: null, usage: { ...usage, cache_write_tokens: 0, total_tokens: 0 } },
    ],
    self_usage: { ...usage, total_tokens: 1_801 },
    subagent_count: 2,
    inclusive_usage: { ...usage, total_tokens: 3_601 },
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
    open_detail: vi.fn(),
    select_session: vi.fn(),
    close_detail: vi.fn(),
    refresh_detail: vi.fn(),
    retry_detail: vi.fn(),
    ...overrides,
  };
}

describe("SessionDetailDrawer", () => {
  it("T-S09-001/T-MU03-C06 renders model-effort blocks and one independent Subagent block for single, unknown, and mixed effort", () => {
    render(<SessionDetailDrawer view={view()} timezone="Asia/Shanghai" />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "session-detail-title");
    expect(screen.getByRole("heading", { name: "A long Session title" })).toBeInTheDocument();
    expect(screen.getByText("root-session-full-id")).toBeInTheDocument();
    expect(dialog.querySelector(".session-detail-header")).not.toHaveTextContent("Main Session");
    expect(dialog.querySelector(".session-detail-header")).not.toHaveTextContent("gpt-5");
    expect(screen.getByText("合计 Token")).toBeInTheDocument();
    expect(screen.getByText("Main", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Subagent", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Main (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Subagent (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "gpt-5 (high)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "o4-mini (—)" })).toBeInTheDocument();
    expect(screen.getByText("gpt-5 (high)", { selector: ".session-detail-subagent-model" })).toBeInTheDocument();
    expect(screen.getByText("o4-mini (mixed)", { selector: ".session-detail-subagent-model" })).toBeInTheDocument();
    expect(screen.queryByText(/个模型配置/)).not.toBeInTheDocument();
    expect(screen.getAllByText("总 Token")).toHaveLength(3);
    expect(screen.getAllByText("预估费用")).toHaveLength(3);
    expect(screen.getByText("合计费用")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0", { selector: "dd" })).toHaveLength(2);
    expect(Array.from(dialog.querySelectorAll<HTMLElement>(".session-detail-summary strong"), (node) => node.textContent)).toEqual(["3,601", "1,801", "1,800", "—"]);
    expect(dialog.querySelectorAll(".session-detail-summary > div")).toHaveLength(4);
    expect(dialog.querySelectorAll(".session-detail-copy-button")).toHaveLength(0);
    expect(dialog).toHaveTextContent("subagent-recent-full-id");
    expect(dialog).toHaveTextContent("subagent-old-full-id");
    expect(dialog.querySelectorAll(".session-detail-usage-block")).toHaveLength(2);
    expect(dialog.querySelectorAll(".session-detail-usage-block .session-detail-usage-item")).toHaveLength(16);
    expect(dialog.querySelectorAll(".session-detail-subagent-block .session-detail-usage-item")).toHaveLength(8);
    const toggles = screen.getAllByRole("button", { name: /Subagent 详情/ });
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggles[1]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "true");
    expect(dialog.querySelectorAll(".session-detail-subagent-block .session-detail-usage-item")).toHaveLength(16);
    expect(screen.getAllByText("推理 Token")).toHaveLength(4);
    expect(screen.getAllByLabelText("推理 Token：8")).toHaveLength(4);
    expect(dialog.querySelectorAll('[aria-label="缓存写入：未知"]')).toHaveLength(3);
    expect(dialog.querySelectorAll('[aria-label="缓存写入：0"]')).toHaveLength(1);
    expect(dialog.querySelectorAll('[aria-label="预估费用：未知"]')).toHaveLength(4);
  });

  it("T-MU04-E01 renders the four-item summary from inclusive cost/status without recomputing child costs", () => {
    const completeDetail: SessionDetailResponse = {
      ...detail,
      main: {
        ...detail.main,
        inclusive_usage: { ...detail.main.inclusive_usage, estimated_cost: 12.34, estimated_cost_status: "complete" },
      },
    };
    const partialDetail: SessionDetailResponse = {
      ...completeDetail,
      main: {
        ...completeDetail.main,
        inclusive_usage: { ...completeDetail.main.inclusive_usage, estimated_cost: 9.87, estimated_cost_status: "partial" },
      },
    };

    const complete = render(<SessionDetailDrawer view={view({ detail: completeDetail })} timezone="Asia/Shanghai" />);
    const completeSummary = screen.getByRole("region", { name: "Session 合计" });
    expect(completeSummary.querySelectorAll(":scope > div")).toHaveLength(4);
    expect(completeSummary.querySelector(".session-detail-summary-cost")).toHaveTextContent("$12.34");
    expect(completeSummary.querySelector(".session-detail-summary-cost")).not.toHaveClass("is-partial");
    complete.unmount();

    render(<SessionDetailDrawer view={view({ detail: partialDetail })} timezone="Asia/Shanghai" />);
    const partialCost = screen.getByRole("region", { name: "Session 合计" }).querySelector(".session-detail-summary-cost");
    expect(partialCost).toHaveTextContent("$9.87");
    expect(partialCost).toHaveClass("is-partial");
  });

  it("T-MU04-E02 keeps IDs while removing every Drawer copy control and keeps counts adjacent to headings", () => {
    render(<SessionDetailDrawer view={view()} timezone="Asia/Shanghai" />);
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("heading", { name: "Main (2)" }).textContent).toBe("Main (2)");
    expect(screen.getByRole("heading", { name: "Subagent (2)" }).textContent).toBe("Subagent (2)");
    expect(dialog.querySelectorAll(".session-detail-copy-button")).toHaveLength(0);
    expect(screen.getByText("root-session-full-id", { selector: ".session-detail-id" })).toBeInTheDocument();
    expect(screen.getByText("subagent-recent-full-id", { selector: ".session-detail-subagent-id" })).toBeInTheDocument();
    expect(screen.getByText("subagent-old-full-id", { selector: ".session-detail-subagent-id" })).toBeInTheDocument();
  });

  it("T-MU04-E03 puts Subagent identity on the left and model/time metadata on the right", () => {
    render(<SessionDetailDrawer view={view()} timezone="Asia/Shanghai" />);
    const headers = screen.getByRole("dialog").querySelectorAll(".session-detail-subagent-header");
    expect(headers).toHaveLength(2);
    const firstHeader = headers[0];
    const identity = firstHeader.querySelector(".session-detail-subagent-identity");
    const rightMeta = firstHeader.querySelector(".session-detail-subagent-right-meta");
    expect(identity).toHaveTextContent("Recent subagent");
    expect(identity).toHaveTextContent("subagent-recent-full-id");
    expect(identity).not.toHaveTextContent("gpt-5 (high)");
    expect(identity?.querySelector(".session-detail-subagent-meta")).toBeNull();
    expect(rightMeta?.children).toHaveLength(2);
    expect(rightMeta?.children[0]).toHaveClass("session-detail-subagent-model");
    expect(rightMeta?.children[0]).toHaveTextContent("gpt-5 (high)");
    expect(rightMeta?.children[1]).toHaveClass("session-detail-subagent-time");
    expect(rightMeta?.children[1].tagName).toBe("TIME");
    expect(rightMeta?.children[1]).toHaveAttribute("datetime", new Date(detail.subagents[0].last_activity_at_ms).toISOString());
    expect(screen.getAllByRole("button", { name: /Subagent 详情/ })[0]).toHaveAttribute("aria-expanded", "true");
  });

  it("T-MU03-F01 renders the real cost/effort fixture without splitting a Subagent", () => {
    const f01Detail = f01SharedFixture.api_detail as SessionDetailResponse;
    const f01Row = {
      ...row,
      root_session_id: f01Detail.root_session_id,
      title: f01Detail.main.title,
      last_activity_at_ms: f01Detail.last_activity_at_ms,
      models_used: f01Detail.main.models_used,
    };
    render(<SessionDetailDrawer view={view({ detail: f01Detail, selected_row: f01Row })} timezone="Asia/Shanghai" />);
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("heading", { name: "未命名 Session" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Main (3)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "gpt-5.6-sol (high)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "gpt-5.6-sol (medium)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "gpt-5.6-terra (max)" })).toBeInTheDocument();
    expect(screen.getByText("Gate b rereview", { selector: "h4" })).toBeInTheDocument();
    expect(screen.getByText("gpt-5.6-luna (high)", { selector: ".session-detail-subagent-model" })).toBeInTheDocument();
    expect(dialog.querySelectorAll(".session-detail-usage-block")).toHaveLength(3);
    expect(dialog.querySelectorAll(".session-detail-subagent-block")).toHaveLength(1);
    expect(screen.getAllByText("$0.50")).toHaveLength(1);
    expect(screen.getAllByText("$1.00")).toHaveLength(1);
    expect(screen.getAllByText("$1.20")).toHaveLength(1);
    expect(screen.getAllByText("$0.02")).toHaveLength(1);
  });

  it("keeps the dialog open for loading, error, and refreshing states", () => {
    const retry = vi.fn();
    const loading = render(<SessionDetailDrawer view={view({ detail: null, load_state: "loading" })} timezone="Asia/Shanghai" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Session 详情加载中" })).toBeInTheDocument();
    expect(loading.container.querySelectorAll(".session-detail-skeleton-summary > span")).toHaveLength(4);
    loading.unmount();

    render(<SessionDetailDrawer view={view({ detail: null, load_state: "error", error_code: "HTTP_ERROR", retry_detail: retry })} timezone="Asia/Shanghai" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Session 详情加载失败");
    screen.getByRole("button", { name: "重试" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
