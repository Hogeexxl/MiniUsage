import { useEffect, useState } from "react";
import { Button } from "../../ui/beui/button";
import { Input } from "../../ui/beui/input";

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
  const commitPage = () => {
    const target = Number(value);
    if (!Number.isSafeInteger(target) || target < 1 || target > totalPages) {
      setValue(String(page));
      return;
    }
    if (target === page) {
      setValue(String(page));
      return;
    }
    onGoToPage(target);
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs leading-4 text-muted-foreground" aria-live="polite">
      <span>共 {totalItems} 条</span>
      <span className="tabular-nums">{totalPages === 0 ? 0 : page} / {totalPages}</span>
      <Button variant="secondary" size="sm" disabled={page <= 1 || pageState === "loading"} onClick={onPrevious}>上一页</Button>
      <Button variant="secondary" size="sm" disabled={page >= totalPages || pageState === "loading"} onClick={onNext}>下一页</Button>
      <Input
        aria-label="跳转页码"
        inputMode="numeric"
        type="text"
        value={value}
        onChange={setValue}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitPage();
          }
        }}
        onBlur={commitPage}
        disabled={totalPages === 0 || pageState === "loading"}
        className="w-14"
        classNames={{
          field: "h-8",
          input: "px-2 text-center text-xs leading-4 tabular-nums",
        }}
      />
      {pageState === "error" ? <><span className="text-destructive">加载页面失败</span><Button variant="ghost" size="sm" onClick={onRetry}>重试</Button></> : null}
    </div>
  );
}
