import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionItemDto, UsageDto } from "../../data/types";
import type { SessionTableViewModel } from "./sessionTypes";
import { SessionSection } from "./SessionSection";

const usage: UsageDto = {
  input_tokens: 1_234,
  cached_tokens: 100,
  cache_write_tokens: null,
  uncached_input_tokens: 1_134,
  output_tokens: 567,
  reasoning_tokens: 12,
  other_output_tokens: 555,
  total_tokens: 1_801,
  cache_hit_rate: 100 / 1234,
  estimated_cost: 1.25,
  estimated_cost_status: "complete",
};

const item: SessionItemDto = {
  root_session_id: "root-1",
  title: null,
  project_name: "MiniUsage",
  project_path: "/work/MiniUsage",
  last_activity_at_ms: Date.UTC(2026, 7, 10, 8, 9),
  models_used: ["gpt-5", "o4-mini"],
  subagent_count: 2,
  inclusive_usage: { ...usage, total_tokens: 5_678 },
  self_usage: { ...usage, total_tokens: 1_234 },
  subagent_usage: usage,
  data_status: "complete",
  error_code: null,
};

function view(overrides: Partial<SessionTableViewModel> = {}): SessionTableViewModel {
  return {
    range: "today",
    rows: [item],
    timezone: "Asia/Shanghai",
    load_state: "ready",
    page_state: "idle",
    filters: { models: [], projects: [] },
    page: 1,
    total_items: 1,
    total_pages: 1,
    sort_by: "last_activity",
    sort_order: "desc",
    retry_load: vi.fn(),
    go_to_page: vi.fn(),
    previous_page: vi.fn(),
    next_page: vi.fn(),
    select_sort: vi.fn(),
    retry_page: vi.fn(),
    ...overrides,
  };
}

describe("SessionSection v0.2.0", () => {
  it("renders the BeUI eight-column header including sortable combined cost", () => {
    const selectSort = vi.fn();
    render(<SessionSection view={view({ select_sort: selectSort })} />);

    expect(screen.getByRole("heading", { name: "Session 记录" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual([
      "最后活动",
      "标题",
      "项目",
      "模型",
      "总 Token",
      "合计 Token",
      "缓存命中率",
      "合计费用",
    ]);

    for (const label of ["最后活动", "项目", "模型", "总 Token", "合计 Token", "缓存命中率", "合计费用"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    expect(selectSort.mock.calls.map(([field]) => field)).toEqual([
      "last_activity",
      "project",
      "model",
      "total_tokens",
      "combined_total_tokens",
      "cache_hit_rate",
      "combined_estimated_cost",
    ]);
  });

  it("keeps pagination in the Session header and supports direct page input", () => {
    const nextPage = vi.fn();
    const previousPage = vi.fn();
    const goToPage = vi.fn();
    render(
      <SessionSection
        view={view({
          page: 2,
          total_items: 31,
          total_pages: 3,
          next_page: nextPage,
          previous_page: previousPage,
          go_to_page: goToPage,
        })}
      />,
    );

    expect(screen.getByText("共 31 条")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(nextPage).toHaveBeenCalledTimes(1);
    expect(previousPage).toHaveBeenCalledTimes(1);

    const pageInput = screen.getByRole("textbox", { name: "跳转页码" });
    fireEvent.change(pageInput, { target: { value: "3" } });
    fireEvent.keyDown(pageInput, { key: "Enter" });
    expect(goToPage).toHaveBeenCalledWith(3);

    fireEvent.change(pageInput, { target: { value: "99" } });
    fireEvent.keyDown(pageInput, { key: "Enter" });
    expect(goToPage).toHaveBeenCalledTimes(1);
  });

  it("uses BeUI structural loading rows and the approved empty state", () => {
    const loading = render(<SessionSection view={view({ rows: [], load_state: "loading" })} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("当前时间范围暂无 Session 记录")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
    loading.unmount();

    render(<SessionSection view={view({ rows: [], total_items: 0, total_pages: 0 })} />);
    expect(screen.getByText("当前时间范围暂无 Session 记录")).toBeInTheDocument();
  });

  it("keeps bounded refresh and page errors with retry controls", () => {
    const retryLoad = vi.fn();
    const retryPage = vi.fn();
    const rendered = render(
      <SessionSection
        view={view({ load_state: "error", error_code: "UPDATE_FAILED", retry_load: retryLoad })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Session 记录更新失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retryLoad).toHaveBeenCalledTimes(1);
    rendered.unmount();

    render(
      <SessionSection
        view={view({ page_state: "error", total_items: 16, total_pages: 2, retry_page: retryPage })}
      />,
    );
    expect(screen.getByText("加载页面失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retryPage).toHaveBeenCalledTimes(1);
  });
});
