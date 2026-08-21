import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatefulButton } from "./stateful";

describe("StatefulButton official behavior", () => {
  it("keeps the current state visible and reports busy state while animated labels overlap", () => {
    const view = render(
      <StatefulButton state="idle" loadingText="检查中…" successText="已是最新">
        检查更新
      </StatefulButton>,
    );
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();

    view.rerender(
      <StatefulButton state="loading" loadingText="检查中…" successText="已是最新">
        检查更新
      </StatefulButton>,
    );
    const loadingButton = screen.getByRole("button", { name: /检查中…/ });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute("aria-busy", "true");
    expect(loadingButton).toHaveTextContent("检查中…");

    view.rerender(
      <StatefulButton state="success" loadingText="检查中…" successText="已是最新">
        检查更新
      </StatefulButton>,
    );
    const successButton = screen.getByRole("button", { name: /已是最新/ });
    expect(successButton).toHaveAttribute("aria-busy", "false");
    expect(successButton).toHaveTextContent("已是最新");
  });
});
