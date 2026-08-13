import { useEffect, useRef, useState } from "react";

import { serviceClient, type ServiceClient, type ServiceState } from "../data/serviceClient";

type ViewState = ServiceState | "loading" | "stopping" | "error";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ServiceButton({ client = serviceClient }: { client?: ServiceClient }) {
  const [state, setState] = useState<ViewState>("loading");
  const [operationFailed, setOperationFailed] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    void client.getState(controller.signal).then(
      (next) => setState(next),
      (error: unknown) => {
        if (!isAbortError(error)) setState("error");
      },
    );
    return () => requestRef.current?.abort();
  }, [client]);

  const stopService = () => {
    if (state !== "running") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setOperationFailed(false);
    setState("stopping");
    void client.stop(controller.signal).then(
      (next) => setState(next),
      (error: unknown) => {
        if (isAbortError(error)) return;
        setState("running");
        setOperationFailed(true);
      },
    );
  };

  const label =
    state === "running"
      ? "停止服务"
      : state === "stopping"
        ? "停止中…"
        : state === "stopped"
          ? "服务已停止"
          : state === "error"
            ? "服务不可用"
            : "服务状态…";
  const disabled = state !== "running";
  const stopStyle = state === "running" || state === "stopping";

  return (
    <>
      <button
        type="button"
        className={`service-button${stopStyle ? " is-stop" : ""}`}
        disabled={disabled}
        onClick={stopService}
      >
        {label}
      </button>
      <span className="sr-only" aria-live="polite">
        {operationFailed ? "服务操作失败" : ""}
      </span>
    </>
  );
}
