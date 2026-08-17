import type { SessionItemDto } from "../../data/types";
import { formatCost, formatRatio, formatSessionModel, formatSessionProject, formatSessionTime, formatSessionTitle, formatSessionTokenInteger } from "./sessionFormat";

type SessionTableRowProps = {
  item: SessionItemDto;
  timezone: string;
  selected?: boolean;
  onOpen?: (item: SessionItemDto) => void;
};

export function SessionTableRow({ item, timezone, selected = false, onOpen }: SessionTableRowProps) {
  const time = formatSessionTime(item.last_activity_at_ms, timezone);
  const model = formatSessionModel(item.models_used);
  const title = formatSessionTitle(item.title);
  const project = formatSessionProject(item.project_name);
  const isError = item.data_status === "error";
  const inclusive = item.inclusive_usage;
  const self = item.self_usage;
  const cost = formatCost(inclusive?.estimated_cost ?? null);
  const costClassName = inclusive?.estimated_cost_status === "partial"
    ? "session-cost-cell is-partial"
    : "session-cost-cell";
  const activate = () => { if (!isError) onOpen?.(item); };
  const rowClassName = [selected ? "is-selected" : "", `is-${item.data_status}`].filter(Boolean).join(" ");
  return (
    <tr
      className={rowClassName || undefined}
      data-session-root-id={item.root_session_id}
      tabIndex={onOpen && !isError ? 0 : -1}
      aria-selected={selected}
      onClick={onOpen && !isError ? activate : undefined}
      onKeyDown={onOpen && !isError ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      } : undefined}
    >
      <td className="session-text-cell" title={time.title}>{time.text}</td>
      <td className="session-text-cell" title={isError ? `${title} · 数据计算异常` : title}>
        <span className="session-title-content">
          {item.data_status !== "complete" ? (
            <span className={`session-health-icon is-${item.data_status}`} aria-label={item.data_status === "error" ? "数据计算异常" : "数据不完整"} title={item.data_status === "error" ? "数据计算异常" : "数据不完整"}>!</span>
          ) : null}
          <span className="session-title-text">{title}</span>
        </span>
      </td>
      <td className="session-text-cell" title={item.project_path ?? project}>{project}</td>
      <td className="session-text-cell" title={model.title} aria-label={model.accessibleName}>{model.text}</td>
      <td className="session-number-cell" title={self ? String(self.total_tokens) : "数据计算异常"} aria-label={self ? String(self.total_tokens) : "数据计算异常"}>{self ? formatSessionTokenInteger(self.total_tokens).text : "—"}</td>
      <td className="session-number-cell" title={inclusive ? String(inclusive.total_tokens) : "数据计算异常"} aria-label={inclusive ? String(inclusive.total_tokens) : "数据计算异常"}>{inclusive ? formatSessionTokenInteger(inclusive.total_tokens).text : "—"}</td>
      <td className="session-number-cell" title={inclusive ? formatRatio(inclusive.cache_hit_rate).title : "数据计算异常"}>{inclusive ? formatRatio(inclusive.cache_hit_rate).text : "—"}</td>
      <td className={`session-number-cell ${costClassName}`} title={isError ? "数据计算异常" : cost.title}>{isError ? "—" : cost.text}</td>
    </tr>
  );
}
