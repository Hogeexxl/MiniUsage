import { useEffect, useState } from "react";

type SessionTableFooterProps = {
  page: number;
  totalItems: number;
  totalPages: number;
  pageState: "idle" | "loading" | "error";
  onPrevious: () => void;
  onNext: () => void;
  onGoToPage: (page: number) => void;
  onRetry: () => void;
};

export function SessionTableFooter({ page, totalItems, totalPages, pageState, onPrevious, onNext, onGoToPage, onRetry }: SessionTableFooterProps) {
  const [value, setValue] = useState(String(page));
  useEffect(() => setValue(String(page)), [page]);
  if (totalItems === 0 && pageState !== "error") return null;
  const submit = () => {
    const target = Number(value);
    if (Number.isSafeInteger(target) && target >= 1 && target <= totalPages) onGoToPage(target);
    else setValue(String(page));
  };
  return (
    <div className="session-table-footer" aria-live="polite">
      <span className="session-page-summary">共 {totalItems} 条</span>
      <span className="session-page-status">当前 {totalPages === 0 ? 0 : page} / {totalPages} 页</span>
      <button type="button" className="retry-button" disabled={page <= 1 || pageState === "loading"} onClick={onPrevious}>上一页</button>
      <button type="button" className="retry-button" disabled={page >= totalPages || pageState === "loading"} onClick={onNext}>下一页</button>
      <label className="session-page-jump">
        跳转页码
        <input
          aria-label="跳转页码"
          inputMode="numeric"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
          onBlur={submit}
          disabled={totalPages === 0 || pageState === "loading"}
        />
      </label>
      {pageState === "error" ? <><span>加载页面失败</span><button type="button" className="retry-button" onClick={onRetry}>重试</button></> : null}
    </div>
  );
}
