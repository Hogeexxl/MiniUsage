import { fireEvent, render, screen, within } from "@testing-library/react";
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
  estimated_cost: 1_240,
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

const compactUsage: SummaryUsageDto = {
  ...usage,
  input_tokens: 12_200_000,
  cached_tokens: 8_700_000,
  output_tokens: 6_200_000,
  reasoning_tokens: 2_100_000,
  other_output_tokens: 4_100_000,
  total_tokens: 18_400_000,
  cache_hit_rate: 8_700_000 / 12_200_000,
};

const TOKEN_BAR_LABEL = "输入与输出 Token 构成；推理 Token 包含在输出 Token 中";

function cardByTitle(title: string): HTMLElement {
  const card = screen.getByText(title).closest(".h-36");
  if (!card) throw new Error(`Metric card not found: ${title}`);
  return card as HTMLElement;
}

function segmentByClass(bar: HTMLElement, className: string): HTMLElement {
  const segment = Array.from(bar.children).find((child) => child.classList.contains(className));
  if (!segment) throw new Error(`Bar segment not found: ${className}`);
  return segment as HTMLElement;
}

function widths(segments: HTMLElement[]): string[] {
  return segments.map((segment) => segment.style.width);
}

describe("MetricGrid v0.2.0", () => {
  it("[T-S03-001] renders four KPI cards and all required titles without a model filter", () => {
    render(<MetricGrid usage={usage} modelFilterActive={false} />);

    const grid = screen.getByLabelText("KPI 指标");
    expect(grid.children).toHaveLength(4);
    for (const title of ["总 Token", "缓存命中", "会话数量", "预估费用"]) {
      expect(within(grid).getByText(title)).toBeInTheDocument();
    }
  });

  it("[T-S03-001] hides only Session Count while a model filter is active", () => {
    render(<MetricGrid usage={usage} modelFilterActive />);

    const grid = screen.getByLabelText("KPI 指标");
    expect(grid.children).toHaveLength(3);
    expect(within(grid).queryByText("会话数量")).not.toBeInTheDocument();
    for (const title of ["总 Token", "缓存命中", "预估费用"]) {
      expect(within(grid).getByText(title)).toBeInTheDocument();
    }
  });

  it("[T-S03-002] keeps reasoning nested in output with fixed token-bar geometry", () => {
    render(<MetricGrid usage={usage} modelFilterActive={false} />);

    const bar = screen.getByLabelText(TOKEN_BAR_LABEL) as HTMLElement;
    const input = segmentByClass(bar, "bg-accent");
    const output = segmentByClass(bar, "bg-violet");
    const reasoning = segmentByClass(bar, "bg-neon");
    expect(bar.children).toHaveLength(3);

    expect(input).toHaveStyle({ width: "75%" });
    expect(output).toHaveStyle({ left: "75%", width: "25%" });
    expect(reasoning).toHaveStyle({ width: "6.25%" });
    expect(reasoning).toHaveClass("absolute", "right-0");
    expect(reasoning).not.toHaveClass("left-0");
    expect(screen.getByRole("button", { name: /推理 125，包含在输出 Token 中/ })).toBeInTheDocument();

    const inputPct = Number.parseFloat(input.style.width);
    const outputPct = Number.parseFloat(output.style.width);
    const reasoningPct = Number.parseFloat(reasoning.style.width);
    expect(inputPct + outputPct).toBeCloseTo(100);
    expect(inputPct + outputPct + reasoningPct).not.toBeCloseTo(100);

    const before = widths([input, output, reasoning]);
    for (const legend of within(bar.parentElement as HTMLElement).getAllByRole("button")) {
      fireEvent.focus(legend);
      expect(widths([input, output, reasoning])).toEqual(before);
      fireEvent.blur(legend);
    }
  });

  it("[T-S03-003] renders cache and remaining geometry with two interactive dotted legends", () => {
    render(<MetricGrid usage={usage} modelFilterActive={false} />);

    const card = cardByTitle("缓存命中");
    const cached = card.querySelector(".bg-accent")?.parentElement as HTMLElement;
    const remaining = cached.children[1] as HTMLElement;
    expect(cached.children).toHaveLength(2);
    expect((cached.children[0] as HTMLElement).style.width).toBe("40%");
    expect(remaining.style.width).toBe("60%");
    expect(remaining).toHaveClass("bg-muted");
    expect(screen.getByTitle("40.0%")).toBeInTheDocument();

    const legends = within(card).getAllByRole("button");
    expect(legends).toHaveLength(2);
    expect(legends[0]).toHaveAttribute("type", "button");
    expect(legends[0]).toHaveTextContent("缓存读取");
    expect(legends[1]).toHaveTextContent("输入");
    expect(legends[0].firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(legends[1].firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(legends[0].firstElementChild).toHaveClass("bg-accent");
    expect(legends[1].firstElementChild).toHaveClass("bg-muted-foreground");

    const before = widths(Array.from(cached.children) as HTMLElement[]);
    for (const legend of legends) {
      fireEvent.focus(legend);
      expect(widths(Array.from(cached.children) as HTMLElement[])).toEqual(before);
      fireEvent.blur(legend);
    }
  });

  it("[T-S03-005] omits the cost alert for complete pricing and uses the health total denominator", () => {
    render(
      <MetricGrid
        usage={{ ...usage, estimated_cost_status: "complete", cost_incomplete_session_count: 0 }}
        modelFilterActive={false}
      />,
    );

    expect(screen.getByText("5 / 5 会话完整计价")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预估费用完整性提示" })).not.toBeInTheDocument();
  });

  it("[T-S03-005] keeps known partial cost and opens the official popover copy on click", async () => {
    render(<MetricGrid usage={usage} modelFilterActive={false} />);

    const cost = screen.getByTitle("$1,240.00");
    expect(cost).toHaveTextContent("$1.24K");
    expect(screen.getByText("4 / 5 会话完整计价")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "预估费用完整性提示" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toHaveTextContent("有部分费用不完整");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("[T-S03-005] shows an unknown-cost dash and opens its warning copy", async () => {
    render(
      <MetricGrid
        usage={{ ...usage, estimated_cost: null, estimated_cost_status: "unknown", cost_incomplete_session_count: 5 }}
        modelFilterActive={false}
      />,
    );

    expect(within(cardByTitle("预估费用")).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("0 / 5 会话完整计价")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "预估费用完整性提示" });
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toHaveTextContent("当前费用无法完整估算");
  });

  it("[T-S03-006] exposes compact token and cost values with complete original aria/title values", () => {
    render(<MetricGrid usage={compactUsage} modelFilterActive={false} />);

    const token = screen.getByTitle("18,400,000");
    expect(token).toHaveAttribute("aria-label", "18,400,000");
    expect(token).toHaveTextContent("18.4M");

    const cost = screen.getByTitle("$1,240.00");
    expect(cost).toHaveAttribute("aria-label", "$1,240.00");
    expect(cost).toHaveTextContent("$1.24K");
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
