import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type TableSortOrder = "asc" | "desc";
export type TableColumn<T> = {
  id: string;
  header: ReactNode;
  width: string;
  sortable?: boolean;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
};

export interface TableProps<T> {
  rows: T[];
  columns: TableColumn<T>[];
  rowId: (row: T) => string;
  rowHeight?: number;
  loading?: boolean;
  skeletonRows?: number;
  emptyState?: ReactNode;
  sortBy?: string;
  sortOrder?: TableSortOrder;
  onSort?: (columnId: string) => void;
  manualSort?: boolean;
  getRowProps?: (row: T, id: string) => HTMLAttributes<HTMLTableRowElement>;
  selectable?: boolean;
  resizable?: boolean;
  reorderable?: boolean;
  editable?: boolean;
  className?: string;
}

export function Table<T>({ rows, columns, rowId, rowHeight = 48, loading = false, skeletonRows = 15, emptyState = "暂无数据", sortBy, sortOrder = "asc", onSort, manualSort = false, getRowProps, selectable = false, resizable = false, reorderable = false, editable = false, className }: TableProps<T>) {
  const reduce = useReducedMotion();
  void manualSort;
  if (selectable || resizable || reorderable || editable) throw new Error("This MiniUsage BeUI Table integration enables only the approved read-only feature set");
  return (
    <div className={cn("w-full overflow-x-auto rounded-2xl border border-border bg-card", className)}>
      <table className="w-full table-fixed border-collapse text-sm text-foreground">
        <colgroup>{columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
        <thead><tr className="h-10 border-b border-border bg-card">
          {columns.map((column) => {
            const active = sortBy === column.id;
            return <th key={column.id} scope="col" className={cn("px-3 text-[11px] font-medium text-muted-foreground", column.align === "right" ? "text-right" : "text-left")}>
              {column.sortable ? <button type="button" className={cn("inline-flex w-full items-center gap-1.5 rounded-md py-1 hover:text-foreground", column.align === "right" ? "justify-end" : "justify-start")} aria-label={`${String(column.header)}排序`} onClick={() => onSort?.(column.id)}><span>{column.header}</span><motion.span animate={{ opacity: active ? 1 : 0.35, y: 0 }} transition={reduce ? { duration: 0 } : { duration: 0.16 }}>{active && sortOrder === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</motion.span></button> : column.header}
            </th>;
          })}
        </tr></thead>
        <tbody>
          {loading && rows.length === 0 ? Array.from({ length: skeletonRows }, (_, index) => <tr key={`skeleton-${index}`} style={{ height: rowHeight }} className="border-b border-border last:border-b-0">{columns.map((column) => <td key={column.id} className="px-3"><div className={cn("h-3 animate-pulse rounded bg-muted", column.align === "right" ? "ml-auto w-14" : "w-24")} /></td>)}</tr>) : null}
          {rows.map((row) => {
            const id = rowId(row);
            const props = getRowProps?.(row, id) ?? {};
            return <tr key={id} {...props} style={{ height: rowHeight, ...props.style }} className={cn("border-b border-border transition-colors last:border-b-0 hover:bg-muted/50", props.className)}>{columns.map((column) => <td key={column.id} className={cn("overflow-hidden px-3 text-[12px]", column.align === "right" ? "text-right tabular-nums" : "text-left")}>{column.render(row)}</td>)}</tr>;
          })}
          {!loading && rows.length === 0 ? <tr><td colSpan={columns.length} className="h-28 px-4 text-center text-xs text-muted-foreground">{emptyState}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
