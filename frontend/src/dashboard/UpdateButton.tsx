import { miniUsageClient, type MiniUsageClient } from "../data/miniUsageClient";
import { useUpdateController } from "./useUpdateController";

export function UpdateButton({ client = miniUsageClient }: { client?: MiniUsageClient }) {
  const view = useUpdateController({ client });
  const upgrade = view.button_label === "版本升级";
  return (
    <>
      <button
        type="button"
        className={`update-button${upgrade ? " is-upgrade" : ""}`}
        disabled={view.checking}
        aria-busy={view.checking}
        onClick={upgrade ? view.open_release : view.check_for_updates}
      >
        {view.button_label}
      </button>
      {view.feedback ? (
        <span className="update-feedback" role="status" aria-live="polite">
          {view.feedback}
        </span>
      ) : null}
    </>
  );
}
