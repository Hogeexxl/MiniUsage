import { useEffect, useRef, useState } from "react";
import { StatefulButton, type ButtonState } from "../ui/beui/button";
import type { RefreshState } from "./useDashboardController";

type SyncButtonProps = {
  disabled: boolean;
  refreshState: RefreshState;
  lastSyncAtMs: number | null;
  onClick: () => void;
};

export function SyncButton({ disabled, refreshState, lastSyncAtMs, onClick }: SyncButtonProps) {
  const previousSyncRef = useRef(lastSyncAtMs);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (lastSyncAtMs === null || previousSyncRef.current === lastSyncAtMs) return;
    previousSyncRef.current = lastSyncAtMs;
    setSuccess(true);
    const timer = window.setTimeout(() => setSuccess(false), 1600);
    return () => window.clearTimeout(timer);
  }, [lastSyncAtMs]);

  const error = refreshState === "failed" || refreshState === "tracking_error" || refreshState === "source_changed";
  const state: ButtonState = refreshState === "requesting" || refreshState === "running" ? "loading" : error ? "error" : success ? "success" : "idle";

  return (
    <StatefulButton
      state={state}
      variant="outline"
      size="sm"
      ripple={false}
      disabled={disabled}
      loadingText="同步中…"
      successText="同步完成"
      errorText="同步失败"
      onClick={onClick}
    >
      同步数据
    </StatefulButton>
  );
}
