import type { HTMLAttributes, ReactNode } from "react";

export type SortDirection = "asc" | "desc";

export type SortState = {
  key: string;
  direction: SortDirection;
};

export type TableColumn<T> = {
  key: string;
  header: ReactNode;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: string;
  cell?: (row: T) => ReactNode;
  editable?: boolean;
  sortValue?: (row: T) => string | number;
};

export type InsertPosition = "before" | "after";

export interface TableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  getRowId?: (row: T, index: number) => string;
  selectable?: boolean;
  selectedRowIds?: string[];
  defaultSelectedRowIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  sort?: SortState | null;
  defaultSort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** MiniUsage extension: keep BeUI sort state/header motion but preserve externally ordered rows. */
  manualSort?: boolean;
  resizable?: boolean;
  minColumnWidth?: number;
  onColumnResize?: (key: string, width: number) => void;
  reorderable?: boolean;
  onColumnOrderChange?: (keys: string[]) => void;
  onCellEdit?: (rowId: string, columnKey: string, value: string) => void;
  onColumnRename?: (columnKey: string, value: string) => void;
  onInsertRow?: (index: number, position: InsertPosition) => void;
  onDeleteRow?: (rowId: string, index: number) => void;
  onInsertColumn?: (index: number, position: InsertPosition) => void;
  onDeleteColumn?: (columnKey: string, index: number) => void;
  rowHeight?: number;
  height?: number;
  overscan?: number;
  onEndReached?: () => void;
  loading?: boolean;
  skeletonRows?: number;
  emptyState?: ReactNode;
  className?: string;
  /** MiniUsage extension: inject row click/keyboard/aria semantics without forking BeUI row rendering. */
  getRowProps?: (row: T, id: string) => HTMLAttributes<HTMLTableRowElement>;
}

export type TableRow<T> = { row: T; id: string };

export type HeaderCellRefs = {
  current: Record<string, HTMLTableCellElement | null>;
};
