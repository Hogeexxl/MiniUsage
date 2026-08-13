import { useCallback, useEffect, useRef, useState } from "react";

import {
  miniUsageClient,
  type MiniUsageClient,
  type MiniUsageUpdateClient,
} from "../data/miniUsageClient";
import { type UpdateStatusResponse } from "../data/types";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const FEEDBACK_DURATION_MS = 3_000;

export type UpdateControllerOptions = {
  client?: MiniUsageClient;
  pollIntervalMs?: number;
};

export type UpdateViewModel = {
  status: UpdateStatusResponse | null;
  checking: boolean;
  feedback: string | null;
  button_label: "检查更新" | "检查中…" | "版本升级";
  check_for_updates: () => void;
  open_release: () => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function displayVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function hasUpdateStatusApi(client: MiniUsageClient): client is MiniUsageClient & Pick<MiniUsageUpdateClient, "getUpdateStatus"> {
  return typeof client.getUpdateStatus === "function";
}

function hasUpdateCheckApi(client: MiniUsageClient): client is MiniUsageClient & Pick<MiniUsageUpdateClient, "checkUpdate"> {
  return typeof client.checkUpdate === "function";
}

function hasOpenReleaseApi(client: MiniUsageClient): client is MiniUsageClient & Pick<MiniUsageUpdateClient, "openRelease"> {
  return typeof client.openRelease === "function";
}

export function useUpdateController(options: UpdateControllerOptions = {}): UpdateViewModel {
  const client = options.client ?? miniUsageClient;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const supportsStatus = hasUpdateStatusApi(client);
  const supportsCheck = hasUpdateCheckApi(client);
  const supportsOpenRelease = hasOpenReleaseApi(client);
  const [state, setState] = useState<{
    status: UpdateStatusResponse | null;
    checking: boolean;
    feedback: string | null;
  }>({ status: null, checking: false, feedback: null });
  const statusRef = useRef<UpdateStatusResponse | null>(null);
  const mountedRef = useRef(false);
  const statusRequestRef = useRef<AbortController | null>(null);
  const statusGenerationRef = useRef(0);
  const checkRequestRef = useRef<AbortController | null>(null);
  const checkGenerationRef = useRef(0);
  const openRequestRef = useRef<AbortController | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current !== null) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  const showFeedback = useCallback(
    (message: string) => {
      clearFeedbackTimer();
      setState((current) => ({ ...current, feedback: message }));
      feedbackTimerRef.current = setTimeout(() => {
        feedbackTimerRef.current = null;
        if (mountedRef.current) setState((current) => ({ ...current, feedback: null }));
      }, FEEDBACK_DURATION_MS);
    },
    [clearFeedbackTimer],
  );

  const requestStatus = useCallback(() => {
    if (!supportsStatus || statusRequestRef.current) return;
    const controller = new AbortController();
    const generation = ++statusGenerationRef.current;
    statusRequestRef.current = controller;
    void client.getUpdateStatus(controller.signal).then(
      (response) => {
        if (!mountedRef.current || controller.signal.aborted || generation !== statusGenerationRef.current) return;
        statusRef.current = response;
        setState((current) => ({ ...current, status: response }));
      },
      () => {
        // Status polling is deliberately silent.  The current known state remains visible.
      },
    ).finally(() => {
      if (statusRequestRef.current === controller) statusRequestRef.current = null;
    });
  }, [client, supportsStatus]);

  const checkForUpdates = useCallback(() => {
    if (!supportsCheck || checkRequestRef.current) return;
    statusRequestRef.current?.abort();
    statusRequestRef.current = null;
    statusGenerationRef.current += 1;
    const controller = new AbortController();
    const generation = ++checkGenerationRef.current;
    checkRequestRef.current = controller;
    clearFeedbackTimer();
    setState((current) => ({ ...current, checking: true, feedback: null }));
    void client.checkUpdate(controller.signal).then(
      (response) => {
        if (!mountedRef.current || controller.signal.aborted || generation !== checkGenerationRef.current) return;
        statusRef.current = response;
        setState((current) => ({ ...current, status: response, checking: false }));
        if (response.update_available) {
          showFeedback(`发现新版本 ${displayVersion(response.latest_version ?? response.current_version)}`);
        } else {
          showFeedback(`当前已是最新版本 ${displayVersion(response.current_version)}`);
        }
      },
      (error: unknown) => {
        if (!mountedRef.current || controller.signal.aborted || generation !== checkGenerationRef.current || isAbortError(error)) return;
        setState((current) => ({ ...current, checking: false }));
        showFeedback("检查更新失败，请稍后重试");
      },
    ).finally(() => {
      if (checkRequestRef.current === controller) checkRequestRef.current = null;
    });
  }, [checkGenerationRef, client, clearFeedbackTimer, showFeedback, supportsCheck]);

  const openRelease = useCallback(() => {
    if (!supportsOpenRelease || !statusRef.current?.update_available || openRequestRef.current) return;
    const controller = new AbortController();
    openRequestRef.current = controller;
    void client.openRelease(controller.signal).catch((error: unknown) => {
      if (!mountedRef.current || controller.signal.aborted || isAbortError(error)) return;
      showFeedback("打开更新页面失败，请稍后重试");
    }).finally(() => {
      if (openRequestRef.current === controller) openRequestRef.current = null;
    });
  }, [client, showFeedback, supportsOpenRelease]);

  useEffect(() => {
    if (!supportsStatus && !supportsCheck) return;
    mountedRef.current = true;
    if (supportsStatus) requestStatus();
    const timer = supportsStatus ? window.setInterval(requestStatus, pollIntervalMs) : null;
    return () => {
      mountedRef.current = false;
      if (timer !== null) window.clearInterval(timer);
      statusRequestRef.current?.abort();
      statusRequestRef.current = null;
      checkRequestRef.current?.abort();
      checkRequestRef.current = null;
      openRequestRef.current?.abort();
      openRequestRef.current = null;
      clearFeedbackTimer();
    };
  }, [clearFeedbackTimer, pollIntervalMs, requestStatus, supportsCheck, supportsStatus]);

  const button_label = state.checking ? "检查中…" : state.status?.update_available ? "版本升级" : "检查更新";
  return {
    status: state.status,
    checking: state.checking,
    feedback: state.feedback,
    button_label,
    check_for_updates: checkForUpdates,
    open_release: openRelease,
  };
}
