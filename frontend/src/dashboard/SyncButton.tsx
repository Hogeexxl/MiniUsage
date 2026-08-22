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
  const refreshBusy = refreshState === "requesting" || refreshState === "running";
  const refreshError = refreshState === "failed" || refreshState === "tracking_error" || refreshState === "source_changed";
  const [visualState, setVisualState] = useState<ButtonState>(() => refreshBusy ? "loading" : refreshError ? "error" : "idle");
  const activeCycle = useRef(false);
  const cycleStartLastSyncAtMs = useRef<number | null>(null);
  const cycleSyncUpdated = useRef(false);
  const successTimer = useRef<number | null>(null);

  function clearSuccessTimer() {
    if (successTimer.current === null) return;
    window.clearTimeout(successTimer.current);
    successTimer.current = null;
  }

  function finishCycle() {
    if (successTimer.current !== null) return;
    setVisualState("success");
    successTimer.current = window.setTimeout(() => {
      successTimer.current = null;
      activeCycle.current = false;
      cycleStartLastSyncAtMs.current = null;
      cycleSyncUpdated.current = false;
      setVisualState((current) => current === "success" ? "idle" : current);
    }, 1600);
  }

  function startCycle() {
    clearSuccessTimer();
    activeCycle.current = true;
    cycleStartLastSyncAtMs.current = lastSyncAtMs;
    cycleSyncUpdated.current = false;
    setVisualState("loading");
    onClick();
  }

  useEffect(() => {
    if (activeCycle.current && lastSyncAtMs !== cycleStartLastSyncAtMs.current) {
      cycleSyncUpdated.current = true;
    }

    if (refreshError) {
      clearSuccessTimer();
      activeCycle.current = false;
      cycleStartLastSyncAtMs.current = null;
      cycleSyncUpdated.current = false;
      setVisualState("error");
      return;
    }

    if (refreshBusy) {
      setVisualState("loading");
      return;
    }

    if (activeCycle.current) {
      if (cycleSyncUpdated.current) finishCycle();
      else setVisualState("loading");
      return;
    }

    setVisualState((current) => current === "loading" ? "idle" : current);
  }, [lastSyncAtMs, refreshBusy, refreshError]);

  useEffect(() => () => {
    clearSuccessTimer();
  }, []);

  return (
    <StatefulButton
      state={visualState}
      variant="outline"
      size="sm"
      ripple={false}
      disabled={disabled}
      loadingText="同步中…"
      successText="同步完成"
      errorText="同步失败"
      onClick={startCycle}
    >
      同步数据
    </StatefulButton>
  );
}
