import { useEffect, useId, useRef, useState } from "react";

import type { FormattedValue } from "./format";

type MetricCardNotice = {
  ariaLabel: string;
  message: string;
  severity?: "warning" | "error";
};

type MetricCardProps = {
  label: string;
  value: FormattedValue;
  updated?: boolean;
  notice?: MetricCardNotice;
};

export function MetricCard({ label, value, updated = false, notice }: MetricCardProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const noticeId = useId();
  const [noticeOpen, setNoticeOpen] = useState(false);

  useEffect(() => {
    if (!notice) {
      setNoticeOpen(false);
      return undefined;
    }
    const closeOnOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setNoticeOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNoticeOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("click", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("click", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notice]);

  return (
    <article ref={rootRef} className={`metric-card${updated ? " is-updating" : ""}`}>
      <div className="metric-label-row">
        <p className="metric-label">{label}</p>
        {notice ? (
          <button
            type="button"
            className={`metric-notice-trigger is-${notice.severity ?? "error"}`}
            aria-label={notice.ariaLabel}
            aria-expanded={noticeOpen}
            aria-controls={noticeId}
            onClick={() => setNoticeOpen((open) => !open)}
          >
            <svg className="metric-notice-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.5v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
            </svg>
          </button>
        ) : null}
      </div>
      {notice && noticeOpen ? <div id={noticeId} className={`metric-notice-bubble is-${notice.severity ?? "error"}`} role="status">{notice.message}</div> : null}
      <p className={`metric-value${label === "预估费用" ? " is-cost" : ""}`} title={value.title} aria-label={`${label}：${value.accessibleName}`}>
        {value.text}
      </p>
    </article>
  );
}
