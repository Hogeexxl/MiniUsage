import { useEffect, useRef } from "react";

import { createRevisionFeed, type RevisionFeed } from "../data/revisionFeed";
import { MetricGrid } from "./MetricGrid";
import { RangeSelector } from "./RangeSelector";
import { SyncButton } from "./SyncButton";
import { UpdateButton } from "./UpdateButton";
import { ServiceButton } from "./ServiceButton";
import type { ServiceClient } from "../data/serviceClient";
import { FilterControls } from "./FilterControls";
import { useDashboardController, type DashboardControllerOptions } from "./useDashboardController";
import { SessionSection } from "./session/SessionSection";
import { SessionDetailDrawer } from "./session/SessionDetailDrawer";
import { useSessionTableController } from "./session/useSessionTableController";
import { useSessionDetailController } from "./session/useSessionDetailController";
import { formatLastSyncTime } from "./format";

function loadErrorMessage(loadState: string, _errorCode?: string): string | null {
  if (loadState !== "error") return null;
  return "数据加载失败";
}

function refreshErrorMessage(refreshState: string, errorCode?: string): string | null {
  if (refreshState === "source_changed") return "数据源已变化";
  if (refreshState === "tracking_error") return "同步状态获取失败";
  if (refreshState !== "failed") return null;
  if (errorCode === "FORBIDDEN" || errorCode === "FORBIDDEN_HOST" || errorCode === "FORBIDDEN_ORIGIN") {
    return "无法发起同步";
  }
  return "同步失败";
}

type DashboardPageOptions = DashboardControllerOptions & { serviceClient?: ServiceClient };

export function DashboardPage({ options }: { options?: DashboardPageOptions }) {
  const feedRef = useRef<RevisionFeed | null>(null);
  if (!feedRef.current) {
    feedRef.current = createRevisionFeed({
      client: options?.client,
      eventSourceFactory: options?.eventSourceFactory,
      pollIntervalMs: options?.pollIntervalMs,
    });
  }
  const view = useDashboardController({ ...options, revisionFeed: feedRef.current });
  const sessions = useSessionTableController(view.range, view.filters, { client: options?.client, revisionFeed: feedRef.current });
  const detail = useSessionDetailController(view.range, view.filters, {
    client: options?.client,
    revisionFeed: feedRef.current,
    dataRevision: sessions.data_revision,
    onStaleRevision: sessions.retry_load,
  });
  useEffect(() => () => feedRef.current?.dispose(), []);
  const loading = view.load_state === "loading";
  const loadError = loadErrorMessage(view.load_state, view.error_code);
  const refreshError = refreshErrorMessage(view.refresh_state, view.error_code);
  const statusMessage =
    refreshError ??
    (view.refresh_state === "running"
      ? view.error_code === "TARGET_QUEUED"
        ? "同步等待中…"
        : "同步中…"
      : null);
  const refreshEnabled =
    view.error_code !== "STATUS_NOT_READY" &&
    (view.refresh_state === "idle" || view.refresh_state === "failed");

  return (
    <div className="dashboard-shell">
      <main className="dashboard-content">
        <header className="dashboard-header">
          <h1>Dashboard</h1>
          <div className="dashboard-sync-group">
            <UpdateButton client={options?.client} />
            <span className="dashboard-last-sync">上次更新：{formatLastSyncTime(view.last_scan_completed_at_ms)}</span>
            <SyncButton disabled={!refreshEnabled} onClick={view.request_refresh} />
            <ServiceButton client={options?.serviceClient} />
          </div>
        </header>

        <section className="dashboard-controls" aria-label="Dashboard 控制">
          <div className="dashboard-controls-row">
            <RangeSelector value={view.range} onChange={view.select_range} />
            <FilterControls
              filters={view.filters}
              options={view.filter_options}
              optionsLoading={view.filter_options_loading}
              optionsStale={view.filter_options_stale}
              optionsErrorCode={view.filter_options_error_code}
              anyFilterActive={view.anyFilterActive}
              onChange={view.select_filters}
              onClear={view.clear_filters}
              onRetryOptions={view.retry_filter_options}
            />
          </div>
          {loadError ? (
            <div className="load-error" role="alert" aria-live="polite">
              <span>{loadError}</span>
              <button type="button" className="retry-button" onClick={view.retry_load}>
                重试
              </button>
            </div>
          ) : null}
          {statusMessage ? (
            <div className="status-announcement" aria-live="polite">
              {statusMessage}
              {view.refresh_state === "tracking_error" ? (
                <button type="button" className="retry-button" onClick={view.retry_refresh_status}>
                  重试
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="metrics-section" aria-label="关键指标" aria-busy={loading}>
          <MetricGrid usage={view.metrics} modelFilterActive={view.modelFilterActive} />
        </section>
        <SessionSection view={sessions} detail={detail} />
        <div className="sr-only" aria-live="polite">
          {loading ? "数据加载中…" : loadError ?? statusMessage}
        </div>
      </main>
      <SessionDetailDrawer view={detail} timezone={sessions.timezone} />
    </div>
  );
}

export default DashboardPage;
