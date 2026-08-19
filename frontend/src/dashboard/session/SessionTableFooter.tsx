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
  const submit = () => {
    const target = Number(value);
    if (Number.isSafeInteger(target) && target >= 1 && target <= totalPages) onGoToPage(target);
    else setValue(String(page));
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] leading-4 text-muted-foreground" aria-live="polite">
      <span>共 {totalItems} 条</span>
      <span className="tabular-nums">{totalPages === 0 ? 0 : page} / {totalPages}</span>
      <Button variant="secondary" size="sm" disabled={page <= 1 || pageState === "loading"} onClick={onPrevious}>上一页</Button>
      <Button variant="secondary" size="sm" disabled={page >= totalPages || pageState === "loading"} onClick={onNext}>下一页</Button>
      <Input
        aria-label="跳转页码"
        inputMode="numeric"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
        onBlur={submit}
        disabled={totalPages === 0 || pageState === "loading"}
        className="h-8 w-14 px-2 text-center text-xs tabular-nums"
      />
      {pageState === "error" ? <><span className="text-destructive">加载页面失败</span><Button variant="ghost" size="sm" onClick={onRetry}>重试</Button></> : null}
    </div>
  );
}
