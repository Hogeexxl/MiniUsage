import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatefulButton } from "./stateful";

describe("StatefulButton accessibility", () => {
  it("exposes only the current state label while animated history stays aria-hidden", () => {
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
    expect(screen.getByRole("button", { name: "检查中…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /检查更新检查中/ })).not.toBeInTheDocument();

    view.rerender(
      <StatefulButton state="success" loadingText="检查中…" successText="已是最新">
        检查更新
      </StatefulButton>,
    );
    expect(screen.getByRole("button", { name: "已是最新" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /检查中.*已是最新/ })).not.toBeInTheDocument();
  });
});
