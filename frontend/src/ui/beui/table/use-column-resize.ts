import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { capturePointer, releasePointer } from "../../lib/touch";
import type { HeaderCellRefs, TableColumn } from "./types";

export function useColumnResize<T>({
  orderedColumns,
  thRefs,
  minColumnWidth,
  onColumnResize,
}: {
  orderedColumns: TableColumn<T>[];
  thRefs: HeaderCellRefs;
  minColumnWidth: number;
  onColumnResize?: (key: string, width: number) => void;
}) {
  const resizeRef = useRef<{
    key: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});

  const startResize = useCallback(
    (key: string, event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const snapshot = { ...widths };
      for (const column of orderedColumns) {
        if (snapshot[column.key] == null) {
          const measured = thRefs.current[column.key]?.getBoundingClientRect().width;
          snapshot[column.key] = measured ? Math.round(measured) : minColumnWidth;
        }
      }
      resizeRef.current = {
        key,
        startX: event.clientX,
        startWidth: snapshot[key],
      };
      setWidths(snapshot);
      capturePointer(event.currentTarget, event.pointerId);
    },
    [minColumnWidth, orderedColumns, thRefs, widths],
  );

  const moveResize = useCallback(
    (event: ReactPointerEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      const width = Math.max(minColumnWidth, state.startWidth + (event.clientX - state.startX));
      setWidths((previous) => ({ ...previous, [state.key]: width }));
    },
    [minColumnWidth],
  );

  const endResize = useCallback(
    (event: ReactPointerEvent) => {
      const state = resizeRef.current;
      resizeRef.current = null;
      releasePointer(event.currentTarget, event.pointerId);
      if (state) onColumnResize?.(state.key, widths[state.key] ?? state.startWidth);
    },
    [onColumnResize, widths],
  );

  return { widths, startResize, moveResize, endResize };
}
