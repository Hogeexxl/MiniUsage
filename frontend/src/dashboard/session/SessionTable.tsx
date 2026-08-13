import type { SessionItemDto, SessionSortField, SessionSortOrder } from "../../data/types";
import { SessionTableRow } from "./SessionTableRow";
import { SessionTableSkeleton } from "./SessionTableSkeleton";

type SessionTableProps = {
  rows: SessionItemDto[];
  timezone: string;
  selectedRootSessionId?: string | null;
  onOpenSession?: (row: SessionItemDto) => void;
  loadState: "initial" | "loading" | "ready" | "refreshing" | "error";
  pageState: "idle" | "loading" | "error";
  sortBy: SessionSortField;
  sortOrder: SessionSortOrder;
  onSort: (sortBy: SessionSortField) => void;
};

const sortableColumns: Array<{ field: SessionSortField; label: string }> = [
  { field: "last_activity", label: "最后活动" },
  { field: "project", label: "项目" },
  { field: "model", label: "模型" },
  { field: "total_tokens", label: "总 Token" },
  { field: "combined_total_tokens", label: "合计 Token" },
  { field: "cache_hit_rate", label: "缓存命中率" },
];

function sortableHeader(
  field: SessionSortField,
  label: string,
  sortBy: SessionSortField,
  sortOrder: SessionSortOrder,
  onSort: (sortBy: SessionSortField) => void,
) {
  const active = sortBy === field;
  const arrow = active ? (sortOrder === "asc" ? " ↑" : " ↓") : "";
  return (
    <button type="button" className="session-sort-button" aria-label={`${label}排序${active ? (sortOrder === "asc" ? "升序" : "降序") : ""}`} aria-pressed={active} onClick={() => onSort(field)}>
      {label}{arrow}
    </button>
  );
}

export function SessionTable({ rows, timezone, selectedRootSessionId = null, onOpenSession, loadState, pageState, sortBy, sortOrder, onSort }: SessionTableProps) {
  const loading = loadState === "initial" || loadState === "loading" || pageState === "loading";
  return (
    <div className="session-table-scroll" tabIndex={0} aria-label="Session 记录表格，可横向滚动">
      <table className="session-table" aria-busy={loading || loadState === "refreshing"}>
        <colgroup>
          <col className="session-col-time" /><col className="session-col-title" /><col className="session-col-project" /><col className="session-col-model" />
          <col className="session-col-number" /><col className="session-col-number" /><col className="session-col-rate" /><col className="session-col-cost" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{sortableHeader("last_activity", "最后活动", sortBy, sortOrder, onSort)}</th>
            <th scope="col">标题</th>
            <th scope="col">{sortableHeader("project", "项目", sortBy, sortOrder, onSort)}</th>
            <th scope="col">{sortableHeader("model", "模型", sortBy, sortOrder, onSort)}</th>
            <th scope="col">{sortableHeader("total_tokens", "总 Token", sortBy, sortOrder, onSort)}</th>
            <th scope="col">{sortableHeader("combined_total_tokens", "合计 Token", sortBy, sortOrder, onSort)}</th>
            <th scope="col">{sortableHeader("cache_hit_rate", "缓存命中率", sortBy, sortOrder, onSort)}</th>
            <th scope="col">合计费用</th>
          </tr>
        </thead>
        <tbody aria-live="polite">
          {loading ? <SessionTableSkeleton /> : rows.length === 0 ? <tr><td className="session-state-cell" colSpan={8}>当前时间范围暂无 Session 记录</td></tr> : rows.map((item) => <SessionTableRow key={item.root_session_id} item={item} timezone={timezone} selected={item.root_session_id === selectedRootSessionId} onOpen={onOpenSession} />)}
        </tbody>
      </table>
    </div>
  );
}

export { sortableColumns };
