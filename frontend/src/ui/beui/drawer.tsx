import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { EASE_DRAWER } from "../lib/ease";
import { cn } from "../lib/cn";

export type DrawerSide = "left" | "right";
export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  side?: DrawerSide;
  className?: string;
  overlayClassName?: string;
  ariaLabel?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer({ open, onOpenChange, children, side = "right", className, overlayClassName, ariaLabel = "Drawer" }: DrawerProps) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const first = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
      (first ?? panelRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => !node.hasAttribute("disabled") && node.tabIndex !== -1);
      if (nodes.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, [open, onOpenChange]);

  const x = side === "right" ? "100%" : "-100%";
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <div className="fixed inset-0 z-[80]">
          <motion.button type="button" aria-label="关闭抽屉" className={cn("absolute inset-0 cursor-default bg-black/45", overlayClassName)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : { duration: 0.2 }} onClick={() => onOpenChange(false)} />
          <motion.aside ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={ariaLabel} initial={reduce ? { opacity: 0 } : { x }} animate={reduce ? { opacity: 1 } : { x: 0 }} exit={reduce ? { opacity: 0 } : { x }} transition={reduce ? { duration: 0 } : { duration: 0.36, ease: EASE_DRAWER }} className={cn("absolute inset-y-0 bg-background shadow-2xl outline-none", side === "right" ? "right-0 border-l border-border" : "left-0 border-r border-border", className)}>
            {children}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
