import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import { capturePointer, releasePointer } from "../../lib/touch";
import type { HeaderCellRefs, TableColumn } from "./types";

export function useColumnReorder<T>({
  columns,
  thRefs,
  onColumnOrderChange,
}: {
  columns: TableColumn<T>[];
  thRefs: HeaderCellRefs;
  onColumnOrderChange?: (keys: string[]) => void;
}) {
  const [order, setOrder] = useState<string[]>(() => columns.map((column) => column.key));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const resultKeys = order.filter((key) => byKey.has(key));
    const present = new Set(resultKeys);
    columns.forEach((column, index) => {
      if (present.has(column.key)) return;
      let at = resultKeys.length;
      if (index === 0) {
        at = 0;
      } else {
        const previousIndex = resultKeys.indexOf(columns[index - 1].key);
        at = previousIndex === -1 ? index : previousIndex + 1;
      }
      resultKeys.splice(at, 0, column.key);
      present.add(column.key);
    });
    return resultKeys
      .map((key) => byKey.get(key))
      .filter((column): column is TableColumn<T> => column !== undefined);
  }, [order, columns]);

  const dropIndexFor = useCallback(
    (clientX: number) => {
      for (let index = 0; index < orderedColumns.length; index++) {
        const rect = thRefs.current[orderedColumns[index].key]?.getBoundingClientRect();
        if (rect && clientX < rect.left + rect.width / 2) return index;
      }
      return orderedColumns.length;
    },
    [orderedColumns, thRefs],
  );

  const startReorder = useCallback((key: string, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragKey(key);
    capturePointer(event.currentTarget, event.pointerId);
  }, []);

  const moveReorder = useCallback(
    (event: ReactPointerEvent) => {
      if (!dragKey) return;
      setDropIndex(dropIndexFor(event.clientX));
    },
    [dragKey, dropIndexFor],
  );

  const endReorder = useCallback(
    (event: ReactPointerEvent) => {
      releasePointer(event.currentTarget, event.pointerId);
      if (dragKey && dropIndex !== null) {
        const keys = orderedColumns.map((column) => column.key);
        const from = keys.indexOf(dragKey);
        if (from !== -1) {
          const without = keys.filter((_, index) => index !== from);
          let to = dropIndex;
          if (from < to) to--;
          without.splice(to, 0, dragKey);
          setOrder(without);
          onColumnOrderChange?.(without);
        }
      }
      setDragKey(null);
      setDropIndex(null);
    },
    [dragKey, dropIndex, orderedColumns, onColumnOrderChange],
  );

  return {
    orderedColumns,
    dragKey,
    dropIndex,
    startReorder,
    moveReorder,
    endReorder,
  };
}
