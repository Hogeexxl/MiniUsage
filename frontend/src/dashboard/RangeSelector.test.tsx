import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RangeSelector } from "./RangeSelector";

describe("RangeSelector", () => {
  it("exposes the range group and pressed state", () => {
    const onChange = vi.fn();
    render(<RangeSelector value="today" onChange={onChange} />);
    expect(screen.getByRole("group", { name: "时间范围" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今天" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "本月" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
