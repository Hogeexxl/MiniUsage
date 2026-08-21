import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RangeSelector } from "./RangeSelector";

describe("RangeSelector", () => {
  it("exposes the range tablist and selected state", () => {
    const onChange = vi.fn();
    render(<RangeSelector value="today" onChange={onChange} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    for (const label of ["今天", "昨天", "7d", "30d", "今年"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "今天" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "30d" }));
    expect(onChange).toHaveBeenCalledWith("30d");
  });
});
