import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MetricGrid } from "./MetricGrid";

const usage = {
  input_tokens: 1_500,
  cached_tokens: 0,
  cache_write_tokens: null,
  uncached_input_tokens: null,
  output_tokens: 2_000_000,
  reasoning_tokens: 0,
  other_output_tokens: 2_000_000,
  total_tokens: 3_000_000,
  cache_hit_rate: null,
  estimated_cost: null,
  estimated_cost_status: "unknown" as const,
  session_count: 0,
  session_health: {
    total_sessions: 0,
    complete_sessions: 0,
    incomplete_sessions: 0,
    error_sessions: 0,
  },
};

afterEach(() => vi.useRealTimers());

describe("MetricGrid", () => {
  it("T-S08-001 renders the KPI card matrix without dropping source fields", () => {
    const expectedCards = [
      "预估费用—",
      "总 Token3M",
      "输入 Token1.5K",
      "输出 Token2M",
      "会话数量0",
      "缓存命中率—",
      "缓存读取 Token0",
      "推理 Token0",
    ];

    for (const modelFilterActive of [false, true, false, true]) {
      const { unmount } = render(
        <MetricGrid
          usage={{ ...usage, cache_write_tokens: 123, reasoning_tokens: 0 }}
          modelFilterActive={modelFilterActive}
        />,
      );
      const cards = screen.getAllByRole("article").map((card) => card.textContent);
      const expected = modelFilterActive ? expectedCards.filter((_, index) => index !== 4) : expectedCards;
      expect(cards).toEqual(expected);
      expect(screen.queryByText(/缓存写入 Token/)).not.toBeInTheDocument();
      expect(screen.getByLabelText("总 Token：3000000")).toHaveAttribute("title", "3000000");
      unmount();
    }

    const projectOnly = render(
      <MetricGrid
        usage={{ ...usage, cache_write_tokens: 456, reasoning_tokens: 2_500 }}
        modelFilterActive={false}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(8);
    expect(screen.getByLabelText("推理 Token：2500")).toBeInTheDocument();
    expect(screen.getByLabelText("推理 Token：2500")).toHaveAttribute("title", "2500");
    expect(screen.queryByText(/缓存写入 Token/)).not.toBeInTheDocument();
    projectOnly.unmount();

    const skeleton = render(<MetricGrid usage={null} modelFilterActive={false} />);
    expect(screen.getByLabelText("KPI 加载中").children).toHaveLength(8);
    expect(screen.getByLabelText("KPI 加载中").textContent).toBe("");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    skeleton.rerender(<MetricGrid usage={null} modelFilterActive />);
    expect(screen.getByLabelText("KPI 加载中").children).toHaveLength(7);
    expect(screen.getByLabelText("KPI 加载中").textContent).toBe("");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    skeleton.unmount();
  });

  it("shows same-size hidden skeletons without fabricated zeroes", () => {
    render(<MetricGrid usage={null} modelFilterActive={false} />);
    expect(screen.getByLabelText("KPI 加载中").children).toHaveLength(8);
    expect(screen.getByLabelText("KPI 加载中").textContent).toBe("");
    expect(screen.getByLabelText("KPI 加载中").firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("animates only when a new snapshot identity commits", () => {
    vi.useFakeTimers();
    const { rerender } = render(<MetricGrid usage={usage} modelFilterActive={false} />);
    const card = screen.getAllByRole("article")[0];
    expect(card).not.toHaveClass("is-updating");
    rerender(<MetricGrid usage={{ ...usage, input_tokens: 2_500 }} modelFilterActive={false} />);
    expect(card).toHaveClass("is-updating");
    act(() => vi.advanceTimersByTime(120));
    expect(card).not.toHaveClass("is-updating");
  });

  it("T-MU04-D02 keeps complete cost quiet and exposes a dismissible partial warning", () => {
    const complete = render(
      <MetricGrid
        usage={{ ...usage, estimated_cost: 1.25, estimated_cost_status: "complete" }}
        modelFilterActive={false}
      />,
    );
    expect(screen.getByLabelText("预估费用：$1.25")).toHaveClass("is-cost");
    expect(screen.queryByRole("button", { name: "预估费用完整性提示" })).not.toBeInTheDocument();
    complete.unmount();

    render(
      <MetricGrid
        usage={{ ...usage, estimated_cost: 1.25, estimated_cost_status: "partial" }}
        modelFilterActive={false}
      />,
    );
    const value = screen.getByLabelText("预估费用：$1.25");
    expect(value).toHaveClass("is-cost");
    const trigger = screen.getByRole("button", { name: "预估费用完整性提示" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("有部分费用不完整")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("有部分费用不完整")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("T-MU04-D02 warns for unknown cost while keeping the value as an em dash", () => {
    render(<MetricGrid usage={usage} modelFilterActive={false} />);
    expect(screen.getByLabelText("预估费用：未知")).toHaveTextContent("—");
    const trigger = screen.getByRole("button", { name: "预估费用完整性提示" });
    fireEvent.click(trigger);
    expect(screen.getByText("当前费用无法完整估算")).toBeInTheDocument();
  });
});
