import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionItemDto } from "../../data/types";
import { SessionTableRow } from "./SessionTableRow";

const usage = {
  input_tokens: 10,
  cached_tokens: 0,
  cache_write_tokens: null,
  uncached_input_tokens: 10,
  output_tokens: 20,
  reasoning_tokens: 0,
  other_output_tokens: 20,
  total_tokens: 30,
  cache_hit_rate: null,
  estimated_cost: 1.25,
  estimated_cost_status: "complete" as const,
};

const item: SessionItemDto = {
  root_session_id: "root-1",
  title: "Session",
  project_name: "MiniUsage",
  project_path: "/work/MiniUsage",
  last_activity_at_ms: Date.UTC(2026, 7, 10, 8, 9),
  models_used: ["gpt-5"],
  subagent_count: 0,
  inclusive_usage: usage,
  self_usage: usage,
  subagent_usage: { ...usage, estimated_cost: null, estimated_cost_status: "unknown" },
};

describe("SessionTableRow cost completeness", () => {
  it("T-MU04-D01 keeps complete costs in the normal cell", () => {
    render(<table><tbody><SessionTableRow item={item} timezone="Asia/Shanghai" /></tbody></table>);
    const costCell = screen.getByRole("cell", { name: "$1.25" });
    expect(costCell).toHaveClass("session-cost-cell");
    expect(costCell).not.toHaveClass("is-partial");
  });

  it("T-MU04-D01 marks only a partial subtotal cell", () => {
    render(
      <table><tbody><SessionTableRow item={{ ...item, inclusive_usage: { ...usage, estimated_cost_status: "partial" } }} timezone="Asia/Shanghai" /></tbody></table>,
    );
    const costCell = screen.getByRole("cell", { name: "$1.25" });
    expect(costCell).toHaveClass("session-cost-cell", "is-partial");
    expect(costCell).toHaveTextContent("$1.25");
    expect(costCell).toHaveAttribute("title", "$1.25");
    expect(costCell).not.toHaveAttribute("title", expect.stringContaining("部分"));
  });

  it("T-MU04-D01 renders unknown cost as an em dash without the partial class", () => {
    render(
      <table><tbody><SessionTableRow item={{ ...item, inclusive_usage: { ...usage, estimated_cost: null, estimated_cost_status: "unknown" } }} timezone="Asia/Shanghai" /></tbody></table>,
    );
    const costCell = document.querySelector(".session-cost-cell");
    expect(costCell).not.toBeNull();
    expect(costCell).toHaveTextContent("—");
    expect(costCell).toHaveClass("session-cost-cell");
    expect(costCell).not.toHaveClass("is-partial");
  });
});
