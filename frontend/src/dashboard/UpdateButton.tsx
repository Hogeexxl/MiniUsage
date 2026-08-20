import { miniUsageClient, type MiniUsageClient } from "../data/miniUsageClient";
import { StatefulButton, type ButtonState } from "../ui/beui/button";
import { useUpdateController } from "./useUpdateController";

export function UpdateButton({ client = miniUsageClient }: { client?: MiniUsageClient }) {
  const view = useUpdateController({ client });
  const upgrade = view.button_label === "版本升级";
  const state: ButtonState = view.checking
    ? "loading"
    : view.feedback?.includes("失败")
      ? "error"
      : view.feedback?.includes("最新版本")
        ? "success"
        : "idle";

  return (
    <StatefulButton
      state={state}
      variant="primary"
      size="sm"
      ripple={false}
      loadingText="检查中…"
      successText="已是最新"
      errorText="检查失败"
      onClick={upgrade ? view.open_release : view.check_for_updates}
    >
      {upgrade ? "版本升级" : "检查更新"}
    </StatefulButton>
  );
}
