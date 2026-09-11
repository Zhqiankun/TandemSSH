import { HistoryRecordSummary } from "./HistoryRecordSummary";
import { HistoryExport } from "./HistoryExport";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { taskHistoryApi } from "@/api/task-history-api";
import { collaborationErrorCode } from "@/api/collaboration-api";
import type {
  AuditHistoryPage,
  AuditHistoryItem,
  AuditHistoryDetail,
} from "@/types/task-history";
export function TaskHistoryButton({ taskId }: { taskId?: string }) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("tandem-open-history", { detail: { taskId } }),
        )
      }
    >
      {t("tandem.history.open")}
    </Button>
  );
}
export function TaskHistoryDialog({ userId }: { userId: string | null }) {
  const { t } = useTranslation(),
    [request, setRequest] = useState<{ taskId?: string }>();
  useEffect(() => {
    const open = (event: Event) => {
      if (!userId) return;
      const taskId = (event as CustomEvent<{ taskId?: unknown }>).detail
        ?.taskId;
      setRequest({
        taskId:
          typeof taskId === "string" && taskId.length <= 128
            ? taskId
            : undefined,
      });
    };
    const close = () => setRequest(undefined);
    window.addEventListener("tandem-open-history", open);
    window.addEventListener("termix:logout", close);
    return () => {
      window.removeEventListener("tandem-open-history", open);
      window.removeEventListener("termix:logout", close);
    };
  }, [userId]);
  if (!userId) return null;
  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) setRequest(undefined);
      }}
    >
      <DialogContent className="sm:max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("tandem.history.title")}</DialogTitle>
          <DialogDescription>{t("tandem.history.readOnly")}</DialogDescription>
        </DialogHeader>
        {request && (
          <HistoryBrowser
            key={userId + ":" + (request.taskId ?? "")}
            initialTaskId={request.taskId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function HistoryBrowser({ initialTaskId }: { initialTaskId?: string }) {
  const { t } = useTranslation(),
    [draft, setDraft] = useState(initialTaskId ?? ""),
    [filter, setFilter] = useState(initialTaskId),
    [cursor, setCursor] = useState<string>(),
    [back, setBack] = useState<Array<string | undefined>>([]),
    [page, setPage] = useState<AuditHistoryPage>(),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string>(),
    [selected, setSelected] = useState<AuditHistoryItem>();
  useEffect(() => {
    const stop = new AbortController();
    let live = true;
    setBusy(true);
    setError(undefined);
    setPage(undefined);
    setSelected(undefined);
    void (async () => {
      let next = cursor,
        response: AuditHistoryPage | undefined,
        skipped = 0;
      for (let i = 0; i < 16; i++) {
        response = await taskHistoryApi.query(
          { taskId: filter, cursor: next, limit: 25 },
          stop.signal,
        );
        skipped += response.skipped;
        if (response.items.length || !response.nextCursor) break;
        next = response.nextCursor;
      }
      if (live && response) setPage({ ...response, skipped });
    })()
      .catch((e) => {
        if (live) setError(collaborationErrorCode(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
      stop.abort();
    };
  }, [filter, cursor]);
  const chooseTask = (taskId?: string) => {
    setDraft(taskId ?? "");
    setFilter(taskId);
    setCursor(undefined);
    setBack([]);
  };
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          chooseTask(draft.trim() || undefined);
        }}
      >
        <label className="flex-1 text-sm">
          {t("tandem.history.taskFilter")}
          <input
            className="block w-full rounded border border-border p-2"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={128}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {t("tandem.history.filter")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => chooseTask()}
        >
          {t("tandem.history.all")}
        </Button>
      </form>
      <HistoryExport key={JSON.stringify(filter ?? null)} taskId={filter} />
      {busy && <p role="status">{t("tandem.history.loading")}</p>}
      {error && (
        <p role="alert" className="text-amber-500">
          {t("tandem.collaboration.errors." + error, {
            defaultValue: t("tandem.history.failed"),
          })}
        </p>
      )}
      {selected && (
        <HistoryDetail
          key={selected.id}
          item={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
      {page && (
        <>
          <p className="text-xs text-muted-foreground">
            {t("tandem.history.retention", {
              days: page.retentionDays,
              megabytes: Math.round(page.maxBytes / 1024 / 1024),
            })}
          </p>
          {page.skipped > 0 && (
            <p role="status" className="text-sm text-amber-500">
              {t("tandem.history.skipped", { count: page.skipped })}
            </p>
          )}
          {!page.items.length && <p>{t("tandem.history.empty")}</p>}
          <div className="space-y-2">
            {page.items.map((item) => (
              <article
                key={item.id}
                className="rounded border border-border p-3 space-y-1 text-sm"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>
                    {t("tandem.history.events." + item.type, {
                      defaultValue: t("tandem.history.systemRecord"),
                    })}
                  </strong>
                  <time className="text-xs text-muted-foreground">
                    {new Date(item.at).toLocaleString()}
                  </time>
                </div>
                {item.title && <p className="break-all">{item.title}</p>}
                <HistoryRecordSummary item={item} />
                {(item.commandPreview || item.program || item.path) && (
                  <code className="block break-all">
                    {item.commandPreview ?? item.program ?? item.path}
                  </code>
                )}
                {item.commandTruncated && (
                  <p className="text-xs text-muted-foreground">
                    {t("tandem.history.commandPreviewOnly")}
                  </p>
                )}
                {item.status && (
                  <p>
                    {t("tandem.collaboration.operations." + item.status, {
                      defaultValue: t(
                        "tandem.collaboration.states." + item.status,
                        { defaultValue: t("tandem.history.recorded") },
                      ),
                    })}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelected(item)}
                  >
                    {t("tandem.history.detail")}
                  </Button>
                  {item.taskId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => chooseTask(item.taskId)}
                    >
                      {t("tandem.history.onlyTask")}
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <div className="flex justify-between gap-2">
            <Button
              variant="outline"
              disabled={busy || !back.length}
              onClick={() => {
                setCursor(back.at(-1));
                setBack((old) => old.slice(0, -1));
              }}
            >
              {t("tandem.history.previous")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !page.nextCursor}
              onClick={() => {
                setBack((old) => [...old, cursor]);
                setCursor(page.nextCursor!);
              }}
            >
              {t("tandem.history.older")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
function HistoryDetail({
  item,
  onClose,
}: {
  item: AuditHistoryItem;
  onClose: () => void;
}) {
  const { t } = useTranslation(),
    [offset, setOffset] = useState(0),
    [back, setBack] = useState<number[]>([]),
    [data, setData] = useState<AuditHistoryDetail>(),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string>();
  useEffect(() => {
    const stop = new AbortController();
    let live = true;
    setBusy(true);
    setError(undefined);
    void taskHistoryApi
      .detail(item.detail, offset, stop.signal)
      .then((value) => {
        if (live) setData(value);
      })
      .catch((e) => {
        if (live) setError(collaborationErrorCode(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
      stop.abort();
    };
  }, [item.detail, offset]);
  return (
    <section
      className="space-y-2 rounded border border-border bg-muted/30 p-3"
      aria-label={t("tandem.history.detail")}
    >
      <div className="flex justify-between gap-2">
        <strong>{t("tandem.history.detail")}</strong>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
      {busy && <p role="status">{t("tandem.history.loading")}</p>}
      {error && (
        <p role="alert">
          {t("tandem.collaboration.errors." + error, {
            defaultValue: t("tandem.history.failed"),
          })}
        </p>
      )}
      {data && (
        <>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
            {data.text}
          </pre>
          <p className="text-xs">
            {t("tandem.history.segment", {
              from: data.offset + 1,
              to: data.offset + data.text.length,
              total: data.total,
            })}
          </p>
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !back.length}
              onClick={() => {
                setOffset(back.at(-1)!);
                setBack((old) => old.slice(0, -1));
              }}
            >
              {t("tandem.history.previous")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || data.nextOffset === null}
              onClick={() => {
                setBack((old) => [...old, offset]);
                setOffset(data.nextOffset!);
              }}
            >
              {t("tandem.history.nextSegment")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
