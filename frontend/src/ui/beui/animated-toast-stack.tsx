import { AlertCircle, Bell, Check, Info, LoaderCircle, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "../lib/ease";
import { cn } from "../lib/cn";

export type ToastStatus = "neutral" | "info" | "loading" | "success" | "error";
export type ToastPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
export type AnimatedToast = { id: string; title: ReactNode; description?: ReactNode; status?: ToastStatus; icon?: ReactNode; duration?: number; dismissible?: boolean; createdAt?: number };
export type ToastInput = Omit<AnimatedToast, "id" | "createdAt"> & { id?: string };
export interface UseAnimatedToastStackOptions { initialToasts?: ToastInput[]; defaultDuration?: number; limit?: number }
export interface AnimatedToastStackProps { toasts: AnimatedToast[]; onDismiss?: (id: string) => void; position?: ToastPosition; maxVisible?: number; className?: string }

const STACK_SPRING: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.75 };
const CONTENT_TRANSITION = { duration: 0.28, ease: EASE_OUT } as const;
const STATUS_ICON: Record<ToastStatus, LucideIcon> = { neutral: Bell, info: Info, loading: LoaderCircle, success: Check, error: AlertCircle };
const STATUS_CLASS: Record<ToastStatus, string> = {
  neutral: "text-muted-foreground bg-primary/[0.05]",
  info: "text-primary bg-primary/10",
  loading: "text-primary bg-primary/10",
  success: "text-success bg-success/10",
  error: "text-destructive bg-destructive/10",
};
const POSITION_CLASS: Record<ToastPosition, string> = {
  "top-left": "left-4 top-4", "top-center": "left-1/2 top-4 -translate-x-1/2", "top-right": "right-4 top-4",
  "bottom-left": "bottom-6 left-4", "bottom-center": "bottom-6 left-1/2 -translate-x-1/2", "bottom-right": "bottom-6 right-4",
};
let idSeed = 0;
function createToast(input: ToastInput, defaultDuration: number): AnimatedToast {
  return { duration: defaultDuration, dismissible: true, ...input, id: input.id ?? `toast-${Date.now()}-${idSeed++}`, createdAt: Date.now() };
}

export function useAnimatedToastStack({ initialToasts = [], defaultDuration = 4200, limit }: UseAnimatedToastStackOptions = {}) {
  const timers = useRef(new Map<string, number>());
  const [toasts, setToasts] = useState<AnimatedToast[]>(() => initialToasts.map((toast) => createToast(toast, defaultDuration)));
  const dismissToast = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const clearToasts = useCallback(() => setToasts([]), []);
  const showToast = useCallback((input: ToastInput) => {
    const toast = createToast(input, defaultDuration);
    setToasts((current) => { const next = [...current, toast]; return typeof limit === "number" ? next.slice(-limit) : next; });
    return toast.id;
  }, [defaultDuration, limit]);
  const updateToast = useCallback((id: string, patch: Partial<ToastInput>) => {
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, ...patch, id, createdAt: Date.now() } : toast));
  }, []);
  useEffect(() => {
    const active = new Set(toasts.map((toast) => toast.id));
    for (const [id, timer] of timers.current) if (!active.has(id)) { window.clearTimeout(timer); timers.current.delete(id); }
    for (const toast of toasts) {
      const duration = toast.duration ?? defaultDuration;
      const current = timers.current.get(toast.id);
      if (current) window.clearTimeout(current);
      if (duration <= 0) { timers.current.delete(toast.id); continue; }
      timers.current.set(toast.id, window.setTimeout(() => { timers.current.delete(toast.id); dismissToast(toast.id); }, duration));
    }
    return () => undefined;
  }, [defaultDuration, dismissToast, toasts]);
  useEffect(() => () => { for (const timer of timers.current.values()) window.clearTimeout(timer); timers.current.clear(); }, []);
  return useMemo(() => ({ toasts, showToast, updateToast, dismissToast, clearToasts, setToasts }), [toasts, showToast, updateToast, dismissToast, clearToasts]);
}

export function AnimatedToastStack({ toasts, onDismiss, position = "bottom-right", maxVisible = 4, className }: AnimatedToastStackProps) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => setTarget(document.body), []);
  if (!target) return null;
  const visible = toasts.slice(-maxVisible);
  const bottom = position.startsWith("bottom");
  return createPortal(
    <ol aria-live="polite" aria-atomic="false" className={cn("pointer-events-none fixed z-[90] flex w-[calc(100vw-2rem)] max-w-sm gap-2", bottom ? "flex-col-reverse" : "flex-col", POSITION_CLASS[position], className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((toast, index) => <ToastItem key={toast.id} toast={toast} index={index} onDismiss={onDismiss} />)}
      </AnimatePresence>
    </ol>, target,
  );
}

const ToastItem = memo(function ToastItem({ toast, index, onDismiss }: { toast: AnimatedToast; index: number; onDismiss?: (id: string) => void }) {
  const reduce = useReducedMotion();
  const status = toast.status ?? "neutral";
  const Icon = STATUS_ICON[status];
  const canDismiss = toast.dismissible !== false && Boolean(onDismiss);
  return (
    <motion.li layout initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96, filter: "blur(10px)" }} animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: 32, scale: 0.96, filter: "blur(8px)", transition: { duration: 0.18, ease: EASE_OUT } }} transition={STACK_SPRING} className="pointer-events-auto relative will-change-transform" style={{ zIndex: 20 - index }}>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <motion.span layout className={cn("mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full", STATUS_CLASS[status])}>
            <AnimatePresence mode="popLayout" initial={false}><motion.span key={status} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.8, filter: "blur(6px)" }} animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.9, filter: "blur(6px)" }} transition={CONTENT_TRANSITION} className={cn("inline-flex", status === "loading" && "animate-spin")}>{toast.icon ?? <Icon className="h-3.5 w-3.5" />}</motion.span></AnimatePresence>
          </motion.span>
          <div className="min-w-0 flex-1"><AnimatePresence mode="popLayout" initial={false}><motion.div key={`${toast.id}-${status}-${String(toast.title)}`} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(6px)" }} animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(6px)" }} transition={CONTENT_TRANSITION}><p className="truncate text-sm font-medium leading-5 text-foreground">{toast.title}</p>{toast.description ? <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">{toast.description}</p> : null}</motion.div></AnimatePresence></div>
          {canDismiss ? <button type="button" onClick={() => onDismiss?.(toast.id)} aria-label="关闭通知" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/[0.06] hover:text-foreground"><X className="h-3.5 w-3.5" /></button> : null}
        </div>
      </div>
    </motion.li>
  );
});
