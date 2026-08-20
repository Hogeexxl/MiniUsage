import { useEffect, useRef, useState } from "react";

import { serviceClient, type ServiceClient, type ServiceState } from "../data/serviceClient";
import { AnimatedToastStack, useAnimatedToastStack } from "../ui/beui/animated-toast-stack";
import { StatefulButton } from "../ui/beui/button";

type ViewState = ServiceState | "loading" | "stopping" | "error";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ServiceButton({ client = serviceClient }: { client?: ServiceClient }) {
  const [state, setState] = useState<ViewState>("loading");
  const requestRef = useRef<AbortController | null>(null);
  const toast = useAnimatedToastStack();

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    void client.getState(controller.signal).then(
      (next) => setState(next),
      (error: unknown) => {
        if (isAbortError(error)) return;
        setState("error");
        toast.showToast({ status: "error", title: "服务状态读取失败" });
      },
    );
    return () => requestRef.current?.abort();
  }, [client, toast.showToast]);

  const stopService = () => {
    if (state !== "running") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState("stopping");
    const toastId = toast.showToast({
      status: "loading",
      title: "正在停止服务",
      duration: 0,
      dismissible: false,
    });
    void client.stop(controller.signal).then(
      (next) => {
        setState(next);
        toast.updateToast(toastId, {
          status: "success",
          title: "服务已停止",
          dismissible: true,
        });
      },
      (error: unknown) => {
        if (isAbortError(error)) return;
        setState("running");
        toast.updateToast(toastId, {
          status: "error",
          title: "停止服务失败",
          dismissible: true,
        });
      },
    );
  };

  return (
    <>
      <StatefulButton
        state={state === "stopping" ? "loading" : "idle"}
        variant="outline"
        size="sm"
        ripple={false}
        loadingText="停止中…"
        disabled={state !== "running"}
        onClick={stopService}
        className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        停止服务
      </StatefulButton>
      <AnimatedToastStack
        toasts={toast.toasts}
        onDismiss={toast.dismissToast}
        placement="fixed"
      />
    </>
  );
}
