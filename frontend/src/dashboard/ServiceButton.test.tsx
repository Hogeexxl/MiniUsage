import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ServiceClient } from "../data/serviceClient";
import { ServiceButton } from "./ServiceButton";

function fakeClient(overrides: Partial<ServiceClient> = {}): ServiceClient {
  return {
    getState: vi.fn(async () => "running" as const),
    stop: vi.fn(async () => "stopped" as const),
    ...overrides,
  };
}

describe("ServiceButton v0.2.0", () => {
  it("updates the loading toast in place to a dismissible success toast", async () => {
    let finishStop!: () => void;
    const client = fakeClient({
      stop: vi.fn(() => new Promise<"stopped">((resolve) => { finishStop = () => resolve("stopped"); })),
    });
    render(<ServiceButton client={client} />);

    const stopButton = await screen.findByRole("button", { name: "停止服务" });
    expect(stopButton).toHaveClass("text-destructive");
    stopButton.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "停止中…" })).toBeDisabled());
    expect(screen.getByText("正在停止服务")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Dismiss toast" })).not.toBeInTheDocument();

    finishStop();
    await waitFor(() => expect(screen.getByRole("button", { name: "停止服务" })).toBeDisabled());
    expect(screen.getByText("服务已停止")).toBeInTheDocument();
    expect(screen.queryByText("正在停止服务")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const dismiss = screen.getByRole("button", { name: "Dismiss toast" });
    dismiss.click();
    await waitFor(() => expect(screen.queryByText("服务已停止")).not.toBeInTheDocument());
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it("updates the loading toast in place to a dismissible error toast", async () => {
    const client = fakeClient({ stop: vi.fn(async () => { throw new Error("offline"); }) });
    render(<ServiceButton client={client} />);
    const button = await screen.findByRole("button", { name: "停止服务" });
    button.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "停止服务" })).toBeEnabled());
    expect(screen.getByText("停止服务失败")).toBeInTheDocument();
    expect(screen.queryByText("正在停止服务")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Dismiss toast" })).toBeInTheDocument();
  });

  it("surfaces initial service-state failure without enabling a destructive action", async () => {
    const client = fakeClient({ getState: vi.fn(async () => { throw new Error("offline"); }) });
    render(<ServiceButton client={client} />);
    await waitFor(() => expect(screen.getByText("服务状态读取失败")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "停止服务" })).toBeDisabled();
  });
});
