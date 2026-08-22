import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyncButton } from "./SyncButton";

describe("SyncButton v0.2.2", () => {
  it("keeps one sync cycle loading until the completed scan reports a new timestamp", () => {
    vi.useFakeTimers();
    try {
      const onClick = vi.fn();
      const props = {
        disabled: false,
        refreshState: "idle" as const,
        lastSyncAtMs: 1_000,
        onClick,
      };
      const view = render(<SyncButton {...props} />);

      fireEvent.click(screen.getByRole("button", { name: "同步数据" }));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /同步中…/ })).toBeDisabled();

      view.rerender(<SyncButton {...props} refreshState="running" />);
      expect(screen.getByRole("button", { name: /同步中…/ })).toBeDisabled();

      view.rerender(<SyncButton {...props} lastSyncAtMs={2_000} />);
      expect(screen.getByRole("button", { name: /同步完成/ })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_599);
      });
      expect(screen.getByRole("button", { name: /同步完成/ })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole("button", { name: /同步数据/ })).toHaveAttribute("aria-busy", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not animate success for an idle background timestamp update", () => {
    const onClick = vi.fn();
    const view = render(
      <SyncButton
        disabled={false}
        refreshState="idle"
        lastSyncAtMs={1_000}
        onClick={onClick}
      />,
    );

    view.rerender(
      <SyncButton
        disabled={false}
        refreshState="idle"
        lastSyncAtMs={2_000}
        onClick={onClick}
      />,
    );

    expect(screen.getByRole("button", { name: "同步数据" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /同步完成/ })).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });
});
