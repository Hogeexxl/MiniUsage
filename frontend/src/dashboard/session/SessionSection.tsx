import { SessionTable } from "./SessionTable";
import { SessionTableFooter } from "./SessionTableFooter";
import type { SessionTableViewModel } from "./sessionTypes";
import type { SessionDetailControllerViewModel } from "./useSessionDetailController";

export function SessionSection({ view, detail }: { view: SessionTableViewModel; detail?: SessionDetailControllerViewModel }) {
  const refreshing = view.load_state === "refreshing";
  return (
    <section className="session-section" aria-labelledby="session-heading">
      <div className="session-section-heading">
        <h2 id="session-heading">Session记录</h2>
        {refreshing ? <span className="session-refreshing" aria-live="polite">更新中…</span> : null}
      </div>
      <div className="session-table-surface">
        <SessionTable
          rows={view.rows}
          timezone={view.timezone}
          selectedRootSessionId={detail?.selected_root_session_id}
          onOpenSession={detail?.open_detail}
          loadState={view.load_state}
          pageState={view.page_state}
          sortBy={view.sort_by}
          sortOrder={view.sort_order}
          onSort={view.select_sort}
        />
        {view.load_state === "error" ? <div className="session-error" role="alert" aria-live="polite"><span>{view.error_code === "UPDATE_FAILED" || view.error_code === "REVISION_FAILED" ? "Session 记录更新失败" : "Session 记录加载失败"}</span><button type="button" className="retry-button" onClick={view.retry_load}>重试</button></div> : null}
        <SessionTableFooter
          page={view.page}
          totalItems={view.total_items}
          totalPages={view.total_pages}
          pageState={view.page_state}
          onPrevious={view.previous_page}
          onNext={view.next_page}
          onGoToPage={view.go_to_page}
          onRetry={view.retry_page}
        />
      </div>
    </section>
  );
}
