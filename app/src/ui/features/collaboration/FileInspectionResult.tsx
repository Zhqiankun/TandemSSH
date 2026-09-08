import { useTranslation } from "react-i18next";
import type { FileResultView } from "@/types/file-operations";
export function FileInspectionResult({ result }: { result: FileResultView }) {
  const { t, i18n } = useTranslation(),
    directory = result.directory,
    stat = result.metadata;
  if (!directory && !stat) return null;
  const value = directory ?? stat!,
    date = new Date(value.observedAt).toLocaleString(i18n.resolvedLanguage);
  return (
    <section
      className="mt-2 min-w-0 space-y-2 text-xs"
      aria-label={t("tandem.fileInspection.result")}
    >
      <p className="select-text break-all">{value.canonicalPath}</p>
      <p>{t("tandem.fileInspection.observed", { time: date })}</p>
      {directory && (
        <>
          <p>
            {t("tandem.fileInspection.page", {
              shown: directory.entries.length,
              total: directory.total,
              offset: directory.offset,
            })}
          </p>
          {directory.omitted > 0 && (
            <p>
              {t("tandem.fileInspection.omitted", { count: directory.omitted })}
            </p>
          )}
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>{t("tandem.fileInspection.name")}</th>
                  <th>{t("tandem.fileInspection.kind")}</th>
                  <th>{t("tandem.fileInspection.size")}</th>
                  <th>{t("tandem.fileInspection.mode")}</th>
                </tr>
              </thead>
              <tbody>
                {directory.entries.map((entry) => (
                  <tr key={entry.name}>
                    <td className="max-w-64 select-text break-all py-1 pr-2">
                      {entry.name}
                    </td>
                    <td className="pr-2">
                      {t("tandem.fileInspection.kinds." + entry.metadata.kind)}
                    </td>
                    <td className="pr-2">{entry.metadata.size} B</td>
                    <td>{entry.metadata.mode.toString(8).padStart(4, "0")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {directory.nextCursor && <p>{t("tandem.fileInspection.more")}</p>}
          <p>{t("tandem.fileInspection.snapshotHint")}</p>
        </>
      )}
      {stat && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>{t("tandem.fileInspection.kind")}</dt>
          <dd>{t("tandem.fileInspection.kinds." + stat.metadata.kind)}</dd>
          <dt>{t("tandem.fileInspection.size")}</dt>
          <dd>{stat.metadata.size} B</dd>
          <dt>{t("tandem.fileInspection.mode")}</dt>
          <dd>{stat.metadata.mode.toString(8).padStart(4, "0")}</dd>
          <dt>{t("tandem.fileInspection.owner")}</dt>
          <dd>
            UID {stat.metadata.uid} / GID {stat.metadata.gid}
          </dd>
          <dt>{t("tandem.fileInspection.modified")}</dt>
          <dd>
            {new Date(stat.metadata.mtime * 1000).toLocaleString(
              i18n.resolvedLanguage,
            )}
          </dd>
          <dt>{t("tandem.fileInspection.links")}</dt>
          <dd>
            {t(
              stat.followedLinks
                ? "tandem.fileInspection.followed"
                : "tandem.fileInspection.notFollowed",
            )}
          </dd>
        </dl>
      )}
    </section>
  );
}
