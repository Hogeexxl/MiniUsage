import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useId, useState } from "react";
import { SPRING_PANEL } from "../lib/ease";
import { cn } from "../lib/cn";

export interface BouncyAccordionItem { id: string; title: ReactNode; children: ReactNode }
export interface BouncyAccordionProps { items: BouncyAccordionItem[]; value?: string | null; defaultValue?: string | null; onValueChange?: (value: string | null) => void; className?: string }

export function BouncyAccordion({ items, value, defaultValue = null, onValueChange, className }: BouncyAccordionProps) {
  const [internal, setInternal] = useState<string | null>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const reduce = useReducedMotion();
  const baseId = useId();
  const setValue = (next: string | null) => { if (!controlled) setInternal(next); onValueChange?.(next); };
  return (
    <div className={cn("divide-y divide-border rounded-2xl border border-border bg-card", className)}>
      {items.map((item) => {
        const open = current === item.id;
        const panelId = `${baseId}-${item.id}`;
        return (
          <div key={item.id}>
            <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setValue(open ? null : item.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-foreground">
              <span className="min-w-0 flex-1">{item.title}</span>
              <motion.span animate={{ rotate: open ? 180 : 0 }} transition={reduce ? { duration: 0 } : SPRING_PANEL}><ChevronDown className="h-4 w-4 text-muted-foreground" /></motion.span>
            </button>
            <AnimatePresence initial={false}>
              {open ? <motion.div id={panelId} initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }} exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={reduce ? { duration: 0 } : SPRING_PANEL} className="overflow-hidden"><div className="px-4 pb-4">{item.children}</div></motion.div> : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
