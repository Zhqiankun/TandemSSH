import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  collaborationApi,
  collaborationErrorCode,
} from "@/api/collaboration-api";
import type { FileChangeReview } from "@/types/file-automation";
import type { TaskOperation } from "@/types/collaboration-task";
import { Button } from "@/components/button";
export function FileOperationReview({
  taskId,
  operation,
  canApprove,
  disabled,
  onApprove,
}: {
  taskId: string;
  operation: TaskOperation;
  canApprove: boolean;
  disabled: boolean;
  onApprove: (reviewId: string) => void;
}) {
  const { t } = useTranslation(),
    [review, setReview] = useState<FileChangeReview>(),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(false),
    stop = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => stop.current?.abort(), []);
  const load = async () => {
    stop.current?.abort();
    const controller = new AbortController();
    stop.current = controller;
    setLoading(true);
    setError(undefined);
    setReview(undefined);
    try {
      const result = await collaborationApi.fileReview(
        taskId,
        operation.id,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        if (
          result.digest !== operation.digest ||
          result.proposalId !==
            (operation.action.type === "file.write"
              ? operation.action.proposalId
              : undefined)
        )
          throw Error("FILE_REVIEW_REQUIRED");
        setReview(result);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(collaborationErrorCode(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  return (
    <section
      className="tandem-file-review"
      aria-label={t("tandem.fileTools.review")}
    >
      <Button variant="outline" disabled={loading} onClick={() => void load()}>
        {t(loading ? "tandem.fileTools.loading" : "tandem.fileTools.review")}
      </Button>
      {error && (
        <p role="alert">
          {t("tandem.collaboration.errors." + error, {
            defaultValue: t("tandem.fileTools.reviewFailed"),
          })}
        </p>
      )}
      {review && (
        <>
          <p className="select-text break-all">{review.canonicalPath}</p>
          <p>
            {review.format.charset.toUpperCase()} ·{" "}
            {review.format.lineEnding.toUpperCase()} · BOM{" "}
            {review.format.bom ? t("common.yes") : t("common.no")} ·{" "}
            {review.bytes} B
          </p>
          <div className="tandem-file-review-panes">
            <label>
              {t("fileDocument.original")}
              <textarea value={review.before} readOnly spellCheck={false} />
            </label>
            <label>
              {t("tandem.fileTools.proposed")}
              <textarea value={review.after} readOnly spellCheck={false} />
            </label>
          </div>
          <p>{t("tandem.fileTools.reviewHint")}</p>
        </>
      )}
      {canApprove && (
        <Button
          disabled={
            disabled || loading || !review || review.digest !== operation.digest
          }
          onClick={() => review && onApprove(review.reviewId)}
        >
          {t("tandem.fileTools.approve")}
        </Button>
      )}
    </section>
  );
}
