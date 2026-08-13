import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MiniUsageClient } from "../data/miniUsageClient";
import { UpdateButton } from "./UpdateButton";
import { useUpdateController } from "./useUpdateController";

const latest = (update_available: boolean) => ({
  current_version: "0.1.0",
  latest_version: update_available ? "0.1.1" : "0.1.0",
  update_available,
  release_url: "https://github.com/Hogeexxl/MiniUsage/releases/tag/v0.1.1",
  last_checked_at_ms: 1234,
  checking: false,
});

function clientWith(overrides: Partial<MiniUsageClient> = {}): MiniUsageClient {
  return {
    getUpdateStatus: vi.fn(async () => latest(false)),
    checkUpdate: vi.fn(async () => latest(false)),
    openRelease: vi.fn(async () => undefined),
    ...overrides,
  } as MiniUsageClient;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UpdateButton / useUpdateController (T-DIST-009)", () => {
  it("starts from status, checks manually, and keeps other controls enabled", async () => {
    let resolveCheck!: (value: ReturnType<typeof latest>) => void;
    const checkResult = new Promise<ReturnType<typeof latest>>((resolve) => {
      resolveCheck = resolve;
    });
    const checkUpdate = vi.fn(() => checkResult);
    const client = clientWith({ checkUpdate });
    render(
      <>
        <UpdateButton client={client} />
        <button type="button">同步数据</button>
      </>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "检查更新" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(screen.getByRole("button", { name: "检查中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "同步数据" })).toBeEnabled();
    resolveCheck(latest(false));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("当前已是最新版本 v0.1.0"));
    expect(checkUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "检查更新" })).toBeEnabled();
  });

  it("shows a newer version for an automatic check and delegates upgrade to the backend", async () => {
    const openRelease = vi.fn(async () => undefined);
    const client = clientWith({
      getUpdateStatus: vi.fn(async () => latest(true)),
      openRelease,
    });
    render(<UpdateButton client={client} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "版本升级" })).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "版本升级" }));
    await waitFor(() => expect(openRelease).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "版本升级" })).toBeEnabled();
  });

  it("shows the newer-version feedback after a manual check", async () => {
    const client = clientWith({ checkUpdate: vi.fn(async () => latest(true)) });
    render(<UpdateButton client={client} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("发现新版本 v0.1.1"));
    expect(screen.getByRole("button", { name: "版本升级" })).toBeEnabled();
  });

  it("reports manual failures while preserving a known upgrade, and keeps automatic failures silent", async () => {
    const checkUpdate = vi.fn(async () => {
      throw new Error("network details");
    });
    const client = clientWith({
      getUpdateStatus: vi.fn(async () => latest(true)),
      checkUpdate,
    });
    const hook = renderHook(() => useUpdateController({ client }));
    const { result } = hook;
    await waitFor(() => expect(result.current.button_label).toBe("版本升级"));
    act(() => result.current.check_for_updates());
    await waitFor(() => expect(result.current.feedback).toBe("检查更新失败，请稍后重试"));
    expect(result.current.button_label).toBe("版本升级");
    hook.unmount();

    const automaticFailureClient = clientWith({
      getUpdateStatus: vi.fn(async () => {
        throw new Error("network details");
      }),
    });
    render(<UpdateButton client={automaticFailureClient} />);
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("polls local status without triggering checks, deduplicates overlap, and cleans up its timer", async () => {
    vi.useFakeTimers();
    let resolveStatus!: (value: ReturnType<typeof latest>) => void;
    const firstStatus = new Promise<ReturnType<typeof latest>>((resolve) => {
      resolveStatus = resolve;
    });
    const getUpdateStatus = vi.fn(() => firstStatus);
    const checkUpdate = vi.fn(async () => latest(false));
    const client = clientWith({ getUpdateStatus, checkUpdate });
    const view = render(<UpdateButton client={client} />);
    expect(getUpdateStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(getUpdateStatus).toHaveBeenCalledTimes(1);
    expect(checkUpdate).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
      resolveStatus(latest(false));
      await Promise.resolve();
    });
    expect(getUpdateStatus).toHaveBeenCalledTimes(1);
  });
});
