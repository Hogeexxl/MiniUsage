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

describe("ServiceButton", () => {
  it("shows the red stop action while running and becomes terminal after shutdown is accepted", async () => {
    let finishStop!: () => void;
    const client = fakeClient({
      stop: vi.fn(() => new Promise<"stopped">((resolve) => { finishStop = () => resolve("stopped"); })),
    });
    render(<ServiceButton client={client} />);

    const stopButton = await screen.findByRole("button", { name: "停止服务" });
    expect(stopButton).toHaveClass("is-stop");
    stopButton.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "停止中…" })).toBeDisabled());
    finishStop();
    const stoppedButton = await screen.findByRole("button", { name: "服务已停止" });
    expect(stoppedButton).toBeDisabled();
    expect(stoppedButton).not.toHaveClass("is-stop");
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the last stable action available when an operation fails", async () => {
    const client = fakeClient({ stop: vi.fn(async () => { throw new Error("offline"); }) });
    render(<ServiceButton client={client} />);
    const button = await screen.findByRole("button", { name: "停止服务" });
    button.click();
    await waitFor(() => expect(screen.getByRole("button", { name: "停止服务" })).toBeEnabled());
    expect(screen.getByText("服务操作失败")).toBeInTheDocument();
  });
});
