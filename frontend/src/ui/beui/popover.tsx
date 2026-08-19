import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cloneElement, createContext, isValidElement, type ReactElement, type ReactNode, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SPRING_PANEL } from "../lib/ease";
import { cn } from "../lib/cn";

type ContextValue = { open: boolean; setOpen: (open: boolean) => void; triggerRef: React.MutableRefObject<HTMLElement | null>; contentId: string };
const Context = createContext<ContextValue | null>(null);
function usePopover() { const value = useContext(Context); if (!value) throw new Error("Popover parts must be used inside Popover"); return value; }

export function Popover({ children, open, defaultOpen = false, onOpenChange }: { children: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [internal, setInternal] = useState(defaultOpen);
  const controlled = open !== undefined;
  const current = controlled ? open : internal;
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentId = useId();
  const setOpen = (next: boolean) => { if (!controlled) setInternal(next); onOpenChange?.(next); };
  return <Context.Provider value={{ open: current, setOpen, triggerRef, contentId }}>{children}</Context.Provider>;
}

export function PopoverTrigger({ children }: { children: ReactElement }) {
  const ctx = usePopover();
  if (!isValidElement(children)) return children;
  const child = children as ReactElement<Record<string, unknown>>;
  const childOnClick = child.props.onClick as ((event: React.MouseEvent) => void) | undefined;
  return cloneElement(child, { ref: (node: HTMLElement | null) => { ctx.triggerRef.current = node; }, "aria-haspopup": "dialog", "aria-expanded": ctx.open, "aria-controls": ctx.open ? ctx.contentId : undefined, onClick: (event: React.MouseEvent) => { childOnClick?.(event); if (!event.defaultPrevented) ctx.setOpen(!ctx.open); } });
}

export function PopoverContent({ children, align = "end", sideOffset = 8, className }: { children: ReactNode; align?: "start" | "center" | "end"; sideOffset?: number; className?: string }) {
  const ctx = usePopover();
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!ctx.open) return;
    const place = () => {
      const trigger = ctx.triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const r = trigger.getBoundingClientRect();
      const width = panel.offsetWidth;
      const left = align === "start" ? r.left : align === "center" ? r.left + r.width / 2 - width / 2 : r.right - width;
      setPosition({ left: Math.max(8, Math.min(window.innerWidth - width - 8, left)), top: r.bottom + sideOffset });
    };
    place();
    const onPointer = (event: PointerEvent) => { const target = event.target as Node; if (!panelRef.current?.contains(target) && !ctx.triggerRef.current?.contains(target)) ctx.setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { ctx.setOpen(false); ctx.triggerRef.current?.focus(); } };
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true); window.addEventListener("pointerdown", onPointer); window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.removeEventListener("pointerdown", onPointer); window.removeEventListener("keydown", onKey); };
  }, [ctx.open, align, sideOffset]);
  if (typeof document === "undefined") return null;
  return createPortal(<AnimatePresence>{ctx.open ? <motion.div ref={panelRef} id={ctx.contentId} role="dialog" initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(8px)" }} animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, filter: "blur(6px)" }} transition={reduce ? { duration: 0.12 } : SPRING_PANEL} style={{ position: "fixed", left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }} className={cn("z-[9999] rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl", className)}>{children}</motion.div> : null}</AnimatePresence>, document.body);
}
