import { LoaderCircle } from "lucide-react";
import { cn } from "../lib/cn";

export function Loader({ className, label = "加载中" }: { className?: string; label?: string }) {
  return <span role="status" aria-label={label} className={cn("inline-flex items-center justify-center", className)}><LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /></span>;
}
