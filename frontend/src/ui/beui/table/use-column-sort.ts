import { useCallback, useMemo, useState } from "react";
import type { SortState, TableColumn, TableRow } from "./types";
import { readSortValue } from "./utils";

export function useColumnSort<T>({
  rows,
  columns,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  manualSort = false,
}: {
  rows: TableRow<T>[];
  columns: TableColumn<T>[];
  sort?: SortState | null;
  defaultSort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  manualSort?: boolean;
}) {
  const [internalSort, setInternalSort] = useState<SortState | null>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : internalSort;

  const commit = useCallback(
    (next: SortState | null) => {
      if (sortProp === undefined) setInternalSort(next);
      onSortChange?.(next);
    },
    [sortProp, onSortChange],
  );

  const toggleSort = useCallback(
    (key: string) => {
      if (!sort || sort.key !== key) {
        commit({ key, direction: "asc" });
      } else if (sort.direction === "asc") {
        commit({ key, direction: "desc" });
      } else {
        commit(null);
      }
    },
    [sort, commit],
  );

  const sortedRows = useMemo(() => {
    if (manualSort || !sort) return rows;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return rows;
    const copy = [...rows];
    copy.sort((left, right) => {
      const leftValue = readSortValue(left.row, column);
      const rightValue = readSortValue(right.row, column);
      let comparison: number;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        comparison = leftValue - rightValue;
      } else {
        comparison = String(leftValue).localeCompare(String(rightValue));
      }
      return sort.direction === "asc" ? comparison : -comparison;
    });
    return copy;
  }, [rows, sort, columns, manualSort]);

  return { sort, sortedRows, toggleSort };
}
