import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "../lib/ease";
import { cn } from "../lib/cn";

export function Tooltip({ content, children, side = "top", className }: { content: ReactNode; children: ReactElement; side?: "top" | "right" | "bottom" | "left"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const reduce = useReducedMotion();
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const points = { top: { left: r.left + r.width / 2, top: r.top - 8 }, bottom: { left: r.left + r.width / 2, top: r.bottom + 8 }, left: { left: r.left - 8, top: r.top + r.height / 2 }, right: { left: r.right + 8, top: r.top + r.height / 2 } };
    setCoords(points[side]);
  };
  useEffect(() => { if (!open) return; const update = () => place(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true); return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); }; }, [open, side]);
  const transform = side === "top" ? "translate(-50%, -100%)" : side === "bottom" ? "translate(-50%, 0)" : side === "left" ? "translate(-100%, -50%)" : "translate(0, -50%)";
  return <><span ref={ref} className="relative inline-flex align-middle" aria-describedby={id} onPointerEnter={() => { place(); setOpen(true); }} onPointerLeave={() => setOpen(false)} onFocus={() => { place(); setOpen(true); }} onBlur={() => setOpen(false)}>{children}</span>{typeof document !== "undefined" ? createPortal(<AnimatePresence>{open && coords ? <span className="pointer-events-none fixed z-[9999]" style={{ left: coords.left, top: coords.top, transform }}><motion.span id={id} role="tooltip" initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(5px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(3px)" }} transition={reduce ? { duration: 0.1 } : { duration: 0.18, ease: EASE_OUT }} className={cn("block whitespace-nowrap rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-lg", className)}>{content}</motion.span></span> : null}</AnimatePresence>, document.body) : null}</>;
}
