import { miniUsageClient, type MiniUsageClient } from "../data/miniUsageClient";
import { StatefulButton } from "../ui/beui/button";
import { useUpdateController } from "./useUpdateController";

export function UpdateButton({ client = miniUsageClient }: { client?: MiniUsageClient }) {
  const view = useUpdateController({ client });
  if (!view.status?.update_available) return null;

  return (
    <StatefulButton
      state="idle"
      variant="primary"
      size="sm"
      ripple={false}
      onClick={view.open_release}
    >
      检测到新版本
    </StatefulButton>
  );
}
