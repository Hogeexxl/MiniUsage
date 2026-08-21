import type { HTMLAttributes } from "react";
import { cn } from "../../ui/lib/cn";

export function ChartSurface({ className, children, ...articleProps }: HTMLAttributes<HTMLElement>) {
  return (
    <article
      {...articleProps}
      className={cn(
        "min-w-0 rounded-[28px] border border-border bg-[#fcfcfc] p-5 text-card-foreground dark:bg-[#151515]",
        className,
      )}
    >
      {children}
    </article>
  );
}
