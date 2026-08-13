type SyncButtonProps = {
  disabled: boolean;
  onClick: () => void;
};

export function SyncButton({ disabled, onClick }: SyncButtonProps) {
  return (
    <button type="button" className="sync-button" disabled={disabled} onClick={onClick}>
      同步数据
    </button>
  );
}
