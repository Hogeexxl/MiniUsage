import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionItemDto } from "../../data/types";
import type { SessionTableViewModel } from "./sessionTypes";
import { SessionSection } from "./SessionSection";

const usage = {
  input_tokens: 1_234,
  cached_tokens: 100,
  cache_write_tokens: null,
  uncached_input_tokens: 1_134,
  output_tokens: 567,
  reasoning_tokens: 12,
  other_output_tokens: 555,
  total_tokens: 1_801,
  cache_hit_rate: 100 / 1234,
  estimated_cost: null,
  estimated_cost_status: "unknown" as const,
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

describe("SessionSection", () => {
  it("T-S07-001 renders the eight-column Session table and full integer values", () => {
    const selectSort = vi.fn();
    const nextPage = vi.fn();
    const previousPage = vi.fn();
    const goToPage = vi.fn();
    render(<SessionSection view={view({ select_sort: selectSort, next_page: nextPage, previous_page: previousPage, go_to_page: goToPage, page: 2, total_items: 31, total_pages: 3 })} />);
    expect(screen.getByRole("heading", { name: "Session记录" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "最后活动 ↓",
      "标题",
      "项目",
      "模型",
      "总 Token",
      "合计 Token",
      "缓存命中率",
      "合计费用",
    ]);
    expect(screen.getByText("未命名 Session")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "gpt-5, o4-mini" })).toHaveTextContent("gpt-5 +1");
    expect(screen.getByRole("cell", { name: "1234" })).toHaveTextContent("1,234");
    expect(screen.getByRole("cell", { name: "5678" })).toHaveTextContent("5,678");
    expect(screen.getByTitle("1234")).toHaveTextContent("1,234");
    expect(screen.getByTitle("5678")).toHaveTextContent("5,678");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    for (const field of ["最后活动", "项目", "模型", "总 Token", "合计 Token", "缓存命中率"]) {
      screen.getByRole("button", { name: new RegExp(`${field}排序`) }).click();
    }
    expect(selectSort).toHaveBeenCalledTimes(6);
    expect(selectSort.mock.calls.map(([field]) => field)).toEqual([
      "last_activity",
      "project",
      "model",
      "total_tokens",
      "combined_total_tokens",
      "cache_hit_rate",
    ]);
    screen.getByRole("button", { name: "下一页" }).click();
    expect(nextPage).toHaveBeenCalledTimes(1);
    const pageInput = screen.getByRole("textbox", { name: "跳转页码" });
    fireEvent.change(pageInput, { target: { value: "2" } });
    fireEvent.keyDown(pageInput, { key: "Enter" });
    expect(goToPage).toHaveBeenCalledWith(2);
    fireEvent.change(pageInput, { target: { value: "99" } });
    fireEvent.keyDown(pageInput, { key: "Enter" });
    expect(goToPage).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "上一页" }).click();
    expect(previousPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/每页/)).not.toBeInTheDocument();
  });

  it("shows six loading rows, an accessible empty state, and page controls", () => {
    const loading = render(<SessionSection view={view({ rows: [], load_state: "loading" })} />);
    expect(loading.container.querySelectorAll(".session-skeleton-row")).toHaveLength(6);
    expect(loading.container.querySelector("table")?.getAttribute("aria-busy")).toBe("true");
    expect(loading.container.querySelector("tbody")?.getAttribute("aria-live")).toBe("polite");
    loading.unmount();

    const empty = render(<SessionSection view={view({ rows: [] })} />);
    expect(empty.container.querySelector("tbody")?.getAttribute("aria-live")).toBe("polite");
    empty.unmount();

    const next = vi.fn();
    render(<SessionSection view={view({ next_page: next, total_items: 16, total_pages: 2 })} />);
    screen.getByRole("button", { name: "下一页" }).click();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("keeps a missing foreground window behind a full-page skeleton", () => {
    render(<SessionSection view={view({ page_state: "loading" })} />);
    expect(document.querySelectorAll(".session-skeleton-row")).toHaveLength(6);
    expect(screen.queryByText("未命名 Session")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("keeps rows while showing a bounded refresh error and exposes retry", () => {
    const retry = vi.fn();
    render(<SessionSection view={view({ load_state: "error", error_code: "UPDATE_FAILED", retry_load: retry })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Session 记录更新失败");
    expect(screen.getByText("未命名 Session")).toBeInTheDocument();
    screen.getByRole("button", { name: "重试" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps a page error visible in the footer", () => {
    render(<SessionSection view={view({ page_state: "error" })} />);
    expect(screen.getByText("加载页面失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
