import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  FileDocumentFailure,
  FileCharset,
  FileLineEnding,
} from "@/types/file-document";
import type { FileSaveReview } from "../hooks/use-file-document";
export function DocumentFailure({ failure }: { failure: FileDocumentFailure }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="td-document-error">
      <p>
        {t("fileDocument.errors." + failure.error, {
          defaultValue: t("fileDocument.errors.FILE_IO_FAILED"),
        })}
      </p>
      {failure.temporaryPath && (
        <p>
          {t("fileDocument.temporary")}{" "}
          <code className="select-text break-all">{failure.temporaryPath}</code>
        </p>
      )}
      {failure.commitMayHaveOccurred && (
        <p>{t("fileDocument.unknownCommit")}</p>
      )}
    </div>
  );
}
export function FileDocumentReview({
  review,
  draft,
  error,
  saving,
  onChange,
  onBack,
  onSave,
  onLatest,
  onRefresh,
}: {
  review: FileSaveReview;
  draft: string;
  error?: FileDocumentFailure;
  saving: boolean;
  onChange: (review: FileSaveReview) => void;
  onBack: () => void;
  onSave: (takeover?: boolean) => void;
  onLatest: (keepDraft: boolean) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation(),
    heading = useRef<HTMLHeadingElement>(null);
  const latest = error?.latest,
    conflict = !!latest;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const formats: Array<[FileCharset, string]> = [
    ["utf8", "UTF-8"],
    ["utf16le", "UTF-16 LE"],
    ["utf16be", "UTF-16 BE"],
    ["gbk", "GBK"],
    ["gb18030", "GB18030"],
  ];
  const panes = [
    { name: t("fileDocument.original"), value: review.base.content },
    ...(latest
      ? [
          {
            name: t("fileDocument.remote"),
            value:
              latest.encoding === "utf8"
                ? latest.content
                : t("fileDocument.binary"),
          },
        ]
      : []),
    { name: t("fileDocument.local"), value: conflict ? draft : review.content },
  ];
  return (
    <section
      aria-label={t("fileDocument.review")}
      className="td-document-review"
    >
      <header>
        <p>{review.base.document.hostIdentity}</p>
        <h2 tabIndex={-1} ref={heading}>
          {t(conflict ? "fileDocument.conflict" : "fileDocument.review")}
        </h2>
        <p className="select-text break-all">
          {review.saveAs || review.base.document.path}
        </p>
        <p className="select-text break-all">
          {t("fileDocument.actualTarget")}:{" "}
          {review.saveAs
            ? t("fileDocument.newTarget")
            : review.base.document.canonicalPath}
        </p>
        <p>
          {t("fileDocument.mode")}:{" "}
          {review.saveAs
            ? "0600"
            : review.base.document.mode.toString(8).padStart(4, "0")}
        </p>
      </header>
      {error && <DocumentFailure failure={error} />}
      <div className="td-document-panes">
        {panes.map((p) => (
          <label key={p.name}>
            {p.name}
            <textarea
              aria-label={p.name}
              value={p.value}
              readOnly
              spellCheck={false}
            />
          </label>
        ))}
      </div>
      {conflict ? (
        <footer>
          <p>{t("fileDocument.mergeHint")}</p>
          <button onClick={() => onLatest(true)} disabled={saving}>
            {t("fileDocument.merge")}
          </button>
          <button onClick={() => onLatest(false)} disabled={saving}>
            {t("fileDocument.useRemote")}
          </button>
          <button onClick={onBack} disabled={saving}>
            {t("fileDocument.back")}
          </button>
        </footer>
      ) : (
        <>
          <fieldset
            disabled={saving || !!error?.commitMayHaveOccurred}
            className="td-document-options"
          >
            <label>
              {t("fileDocument.encoding")}
              <select
                value={review.format.charset}
                onChange={(e) =>
                  onChange({
                    ...review,
                    format: {
                      ...review.format,
                      charset: e.target.value as FileCharset,
                      bom: ["gbk", "gb18030"].includes(e.target.value)
                        ? false
                        : review.format.bom,
                    },
                  })
                }
              >
                {formats.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("fileDocument.lineEnding")}
              <select
                value={review.format.lineEnding}
                onChange={(e) =>
                  onChange({
                    ...review,
                    format: {
                      ...review.format,
                      lineEnding: e.target.value as FileLineEnding,
                    },
                  })
                }
              >
                <option value="lf">LF</option>
                <option value="crlf">CRLF</option>
                <option value="cr">CR</option>
                <option value="none">{t("fileDocument.noNewline")}</option>
                <option value="mixed" disabled>
                  {t("fileDocument.mixed")}
                </option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={review.format.bom}
                disabled={["gbk", "gb18030"].includes(review.format.charset)}
                onChange={(e) =>
                  onChange({
                    ...review,
                    format: { ...review.format, bom: e.target.checked },
                  })
                }
              />{" "}
              BOM
            </label>
            <label className="td-document-save-as">
              {t("fileDocument.saveAs")}
              <input
                aria-label={t("fileDocument.saveAs")}
                value={review.saveAs ?? ""}
                placeholder={t("fileDocument.saveAsPlaceholder")}
                onChange={(e) =>
                  onChange({ ...review, saveAs: e.target.value })
                }
              />
            </label>
          </fieldset>
          <footer>
            <p>{t("fileDocument.saveHint")}</p>
            <button onClick={onBack} disabled={saving}>
              {t("fileDocument.back")}
            </button>
            {error?.commitMayHaveOccurred ? (
              <button onClick={onRefresh} disabled={saving}>
                {t("fileDocument.refreshKeepDraft")}
              </button>
            ) : (
              <button
                className="td-document-primary"
                disabled={
                  saving ||
                  review.format.lineEnding === "mixed" ||
                  (!!review.saveAs && !review.saveAs.startsWith("/"))
                }
                onClick={() =>
                  onSave(error?.error === "FILE_AUTOMATION_ACTIVE")
                }
              >
                {t(
                  saving
                    ? "fileDocument.saving"
                    : error?.error === "FILE_AUTOMATION_ACTIVE"
                      ? "fileDocument.takeoverSave"
                      : "fileDocument.confirmSave",
                )}
              </button>
            )}
          </footer>
        </>
      )}
    </section>
  );
}
