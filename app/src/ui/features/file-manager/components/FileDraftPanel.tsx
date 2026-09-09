import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { useFileDraft } from "../hooks/use-file-draft";
export function FileDraftPanel({
  draft,
  original,
  content,
  onRestore,
  disabled,
}: {
  draft: ReturnType<typeof useFileDraft>;
  original: string;
  content: string;
  onRestore: (content: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation(),
    [review, setReview] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const snapshot = draft.snapshot;
  return (
    <section className="td-draft-panel" aria-label={t("fileDraft.title")}>
      <div className="td-draft-actions">
        <span>{t("fileDraft.hint")}</span>
        <button
          disabled={!draft.canSave || disabled}
          onClick={() => void draft.save()}
        >
          {t("fileDraft.save")}
        </button>
        {snapshot && (
          <>
            <button
              disabled={disabled || draft.busy}
              onClick={() => setReview(!review)}
            >
              {t("fileDraft.review")}
            </button>
            <button
              disabled={draft.busy}
              onClick={() => setConfirmDelete(!confirmDelete)}
            >
              {t("fileDraft.delete")}
            </button>
          </>
        )}
      </div>
      {draft.busy && <p role="status">{t("fileDraft.busy")}</p>}
      {draft.error && (
        <p role="alert">
          {t("fileDraft.errors." + draft.error, {
            defaultValue: t("fileDraft.failed"),
          })}{" "}
          <button disabled={draft.busy} onClick={draft.reload}>
            {t("fileDraft.reload")}
          </button>
        </p>
      )}
      {snapshot && (
        <p role="status">
          {t(draft.matches ? "fileDraft.saved" : "fileDraft.older", {
            time: new Date(snapshot.savedAt).toLocaleString(),
          })}
        </p>
      )}
      {snapshot && confirmDelete && (
        <div>
          <p>{t("fileDraft.deleteHint")}</p>
          <button
            disabled={draft.busy}
            onClick={() =>
              void draft.remove().then((ok) => {
                if (ok) setConfirmDelete(false);
              })
            }
          >
            {t("fileDraft.confirmDelete")}
          </button>
          <button onClick={() => setConfirmDelete(false)}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      {snapshot && review && (
        <div className="td-draft-review">
          <p>
            {t(
              snapshot.original === original
                ? "fileDraft.unchanged"
                : "fileDraft.changed",
            )}
          </p>
          <p>{t("fileDraft.restoreHint")}</p>
          <div className="td-document-panes">
            {[
              { label: t("fileDraft.original"), value: snapshot.original },
              { label: t("fileDraft.remote"), value: original },
              { label: t("fileDraft.stored"), value: snapshot.content },
            ].map((p) => (
              <label key={p.label}>
                {p.label}
                <textarea readOnly value={p.value} />
              </label>
            ))}
          </div>
          {content !== original && content !== snapshot.content && (
            <p role="alert">{t("fileDraft.replaceEdits")}</p>
          )}
          <button
            disabled={disabled || draft.busy}
            onClick={() => {
              onRestore(snapshot.content);
              setReview(false);
            }}
          >
            {t("fileDraft.restore")}
          </button>
          <button onClick={() => setReview(false)}>{t("common.cancel")}</button>
        </div>
      )}
    </section>
  );
}
