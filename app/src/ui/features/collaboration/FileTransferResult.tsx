import { useTranslation } from "react-i18next";
import type { FileTransferResult as TransferResult } from "@/types/file-transfer";
export function FileTransferResult({ result }: { result: TransferResult }) {
  const { t } = useTranslation();
  return (
    <section
      className="mt-2 min-w-0 space-y-2 text-xs"
      aria-label={t("tandem.transfer.result")}
    >
      <p>
        {t("tandem.collaboration.fileActions." + result.direction)} ·{" "}
        {t("tandem.transfer.bytes", {
          bytes: result.bytes,
          total: result.totalBytes,
        })}
      </p>
      <p>
        {t(
          result.verification === "sha256"
            ? "tandem.transfer.verified"
            : "tandem.transfer.unverified",
        )}
      </p>
      {result.verification === "sha256" && result.sha256 && (
        <code className="select-text break-all">SHA-256 {result.sha256}</code>
      )}
      {result.cleanupRequired && (
        <p className="text-amber-500">{t("tandem.transfer.cleanup")}</p>
      )}
    </section>
  );
}
