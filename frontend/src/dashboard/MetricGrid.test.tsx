import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SummaryUsageDto } from "../data/types";
import { MetricGrid } from "./MetricGrid";

const usage: SummaryUsageDto = {
  input_tokens: 1_500,
  cached_tokens: 600,
  cache_write_tokens: null,
  uncached_input_tokens: null,
  output_tokens: 500,
  reasoning_tokens: 125,
  other_output_tokens: 375,
  total_tokens: 2_000,
  cache_hit_rate: 0.4,
  estimated_cost: 1.25,
  estimated_cost_status: "partial",
  session_count: 4,
  cost_incomplete_session_count: 1,
  session_health: {
    total_sessions: 5,
    complete_sessions: 4,
    incomplete_sessions: 1,
    error_sessions: 0,
  },
};

describe("MetricGrid v0.2.0", () => {
  it("renders the four semantic KPI cards and preserves nested reasoning semantics", () => {
    render(<MetricGrid usage={usage} modelFilterActive={false} />);

    const grid = screen.getByLabelText("KPI 指标");
    expect(grid.children).toHaveLength(4);
    expect(screen.getByText("总 Token")).toBeInTheDocument();
    expect(screen.getByText("缓存命中")).toBeInTheDocument();
    expect(screen.getByText("会话数量")).toBeInTheDocument();
    expect(screen.getByText("预估费用")).toBeInTheDocument();
    expect(screen.getByLabelText("输入与输出 Token 构成；推理 Token 包含在输出 Token 中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /推理 125，包含在输出 Token 中/ })).toBeInTheDocument();
    expect(screen.getByText("仅统计主线程会话。")).toBeInTheDocument();
  });

  it("hides only Session Count when a model filter is active", () => {
    render(<MetricGrid usage={usage} modelFilterActive />);
    expect(screen.getByLabelText("KPI 指标").children).toHaveLength(3);
    expect(screen.queryByText("会话数量")).not.toBeInTheDocument();
    expect(screen.getByText("总 Token")).toBeInTheDocument();
    expect(screen.getByText("缓存命中")).toBeInTheDocument();
    expect(screen.getByText("预估费用")).toBeInTheDocument();
  });

  it("uses cost completeness count from Summary and BeUI Popover for partial cost", async () => {
    render(<MetricGrid usage={usage} modelFilterActive={false} />);
    expect(screen.getByText("3 / 4 会话完整计价")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "预估费用完整性提示" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(await screen.findByText("有部分费用不完整")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("shows unknown cost as dash with the unknown warning", async () => {
    render(
      <MetricGrid
        usage={{ ...usage, estimated_cost: null, estimated_cost_status: "unknown", cost_incomplete_session_count: 4 }}
        modelFilterActive={false}
      />,
    );
    expect(screen.getByText("0 / 4 会话完整计价")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预估费用完整性提示" }));
    expect(await screen.findByText("当前费用无法完整估算")).toBeInTheDocument();
  });

  it("renders structural skeletons without fabricated KPI values", () => {
    const { rerender } = render(<MetricGrid usage={null} modelFilterActive={false} />);
    expect(screen.getByLabelText("KPI 加载中").children).toHaveLength(4);
    expect(screen.getByLabelText("KPI 加载中")).toHaveTextContent("");

    rerender(<MetricGrid usage={null} modelFilterActive />);
    expect(screen.getByLabelText("KPI 加载中").children).toHaveLength(3);
    expect(screen.getByLabelText("KPI 加载中")).toHaveTextContent("");
  });
});
