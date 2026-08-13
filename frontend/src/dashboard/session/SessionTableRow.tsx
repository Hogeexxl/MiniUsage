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
  const cost = formatCost(item.inclusive_usage.estimated_cost);
  const costClassName = item.inclusive_usage.estimated_cost_status === "partial"
    ? "session-cost-cell is-partial"
    : "session-cost-cell";
  const activate = () => onOpen?.(item);
  return (
    <tr
      className={selected ? "is-selected" : undefined}
      data-session-root-id={item.root_session_id}
      tabIndex={onOpen ? 0 : -1}
      aria-selected={selected}
      onClick={onOpen ? activate : undefined}
      onKeyDown={onOpen ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      } : undefined}
    >
      <td className="session-text-cell" title={time.title}>{time.text}</td>
      <td className="session-text-cell" title={title}>{title}</td>
      <td className="session-text-cell" title={item.project_path ?? project}>{project}</td>
      <td className="session-text-cell" title={model.title} aria-label={model.accessibleName}>{model.text}</td>
      <td className="session-number-cell" title={String(item.self_usage.total_tokens)} aria-label={String(item.self_usage.total_tokens)}>{formatSessionTokenInteger(item.self_usage.total_tokens).text}</td>
      <td className="session-number-cell" title={String(item.inclusive_usage.total_tokens)} aria-label={String(item.inclusive_usage.total_tokens)}>{formatSessionTokenInteger(item.inclusive_usage.total_tokens).text}</td>
      <td className="session-number-cell" title={formatRatio(item.inclusive_usage.cache_hit_rate).title}>{formatRatio(item.inclusive_usage.cache_hit_rate).text}</td>
      <td className={`session-number-cell ${costClassName}`} title={cost.title}>{cost.text}</td>
    </tr>
  );
}
