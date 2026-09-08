import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  localFileGrantsApi,
  localFileError,
} from "@/api/local-file-grants-api";
import type { HumanLocalFileGrant } from "@/types/local-file-grants";
function value<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (r.ok === false) throw Error(r.error);
  return r.value;
}
export function TaskLocalFiles({
  taskId,
  disabled,
  onGrantsChange,
}: {
  taskId: string;
  disabled: boolean;
  onGrantsChange?: (grants: HumanLocalFileGrant[]) => void;
}) {
  const { t } = useTranslation(),
    [grants, setGrants] = useState<HumanLocalFileGrant[]>([]),
    [available, setAvailable] = useState(false),
    [busy, setBusy] = useState(false),
    [overwrite, setOverwrite] = useState(false),
    [error, setError] = useState<string>();
  const owned = useRef<{
    live: boolean;
    ticket?: string;
    stop: AbortController;
  }>({ live: true, stop: new AbortController() });
  const notify = useRef(onGrantsChange);
  notify.current = onGrantsChange;
  const native = window.electronAPI?.localFiles;
  const message = (code: string) =>
    t("tandem.collaboration.errors." + code, {
      defaultValue: t("tandem.upload.errors." + code, {
        defaultValue: t("tandem.download.errors." + code, {
          defaultValue: t("tandem.localFiles.failed"),
        }),
      }),
    });
  const refresh = async () => {
    const owner = owned.current;
    const data = await localFileGrantsApi.list(taskId, owner.stop.signal);
    if (owner.live) {
      setGrants(data.grants);
      notify.current?.(data.grants);
      setAvailable(data.available);
    }
  };
  useEffect(() => {
    if (!native) return;
    const owner = { live: true, stop: new AbortController() } as {
      live: boolean;
      ticket?: string;
      stop: AbortController;
    };
    owned.current = owner;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (e) {
        if (owner.live) setError(localFileError(e));
      }
      if (owner.live) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      owner.live = false;
      owner.stop.abort();
      clearTimeout(timer);
      if (owner.ticket)
        void localFileGrantsApi.cancel(taskId, owner.ticket).catch(() => {});
    };
    // The keyed task panel owns one task and its pending native selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  const choose = async (
    direction: "upload" | "download",
    kind?: "directory",
  ) => {
    if (!native || busy || disabled) return;
    const owner = owned.current;
    setBusy(true);
    setError(undefined);
    try {
      const identity = value(await native.identity());
      if (!owner.live) return;
      const ticket = await localFileGrantsApi.ticket(
        taskId,
        {
          windowToken: identity.windowToken,
          direction,
          allowOverwrite: overwrite,
          ...(kind ? { kind } : {}),
        },
        owner.stop.signal,
      );
      owner.ticket = ticket.id;
      if (!owner.live) {
        await localFileGrantsApi.cancel(taskId, ticket.id);
        return;
      }
      value(await native.choose(ticket.id));
      owner.ticket = undefined;
      if (owner.live) await refresh();
    } catch (e) {
      if (owner.live) setError(localFileError(e));
    } finally {
      if (owner.ticket) {
        await localFileGrantsApi.cancel(taskId, owner.ticket).catch(() => {});
        owner.ticket = undefined;
      }
      if (owner.live) setBusy(false);
    }
  };
  const act = async (id: string, action: "revoke" | "forget") => {
    setBusy(true);
    setError(undefined);
    try {
      await localFileGrantsApi.action(taskId, id, action);
      await refresh();
    } catch (e) {
      if (owned.current.live) setError(localFileError(e));
    } finally {
      if (owned.current.live) setBusy(false);
    }
  };
  return (
    <section
      className="my-3 space-y-2 rounded border border-border p-3 text-xs"
      aria-label={t("tandem.localFiles.title")}
    >
      <h3 className="font-medium">{t("tandem.localFiles.title")}</h3>
      <p className="text-muted-foreground">
        {t("tandem.localFiles.description")}
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={overwrite}
          disabled={busy || disabled}
          onChange={(e) => setOverwrite(e.target.checked)}
        />
        {t("tandem.localFiles.overwrite")}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || disabled || !native || !available}
          onClick={() => void choose("upload")}
        >
          {t("tandem.localFiles.upload")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || disabled || !native || !available}
          onClick={() => void choose("download")}
        >
          {t("tandem.localFiles.download")}
        </Button>
        {(["upload", "download"] as const).map((direction) => (
          <Button
            key={direction}
            size="sm"
            variant="outline"
            disabled={busy || disabled || !native || !available}
            onClick={() => void choose(direction, "directory")}
          >
            {t("tandem.directoryTask.select." + direction)}
          </Button>
        ))}
      </div>
      {(!native || !available) && <p>{t("tandem.localFiles.desktop")}</p>}
      {busy && <p role="status">{t("tandem.localFiles.busy")}</p>}
      {error && (
        <p role="alert" className="text-amber-500">
          {message(error)}
        </p>
      )}
      {!grants.length && (
        <p className="text-muted-foreground">{t("tandem.localFiles.empty")}</p>
      )}
      {grants.map((g) => (
        <article key={g.id} className="space-y-1 border-t border-border pt-2">
          <strong>{g.name}</strong>
          <p className="break-all select-text">{g.path}</p>
          <p>
            {t(
              g.kind === "directory"
                ? "tandem.directoryTask.direction." + g.direction
                : "tandem.collaboration.fileActions." + g.direction,
            )}{" "}
            · {t("tandem.localFiles.states." + g.state)} ·{" "}
            {t(
              g.allowOverwrite
                ? "tandem.localFiles.mayOverwrite"
                : "tandem.localFiles.noOverwrite",
            )}
          </p>
          {g.size !== undefined && <p>{g.size} B</p>}
          {g.kind === "directory" && g.entries !== undefined && (
            <p>
              {t("tandem.directoryTask.grantCount", {
                count: g.entries,
                excluded: g.excluded ?? 0,
              })}
            </p>
          )}
          {g.existing && (
            <p>{t("tandem.localFiles.existing", { size: g.existing.size })}</p>
          )}
          {g.temporaryPath && (
            <p className="break-all select-text">
              {t("fileDocument.temporary")} {g.temporaryPath}
            </p>
          )}
          {g.error && <p className="text-amber-500">{message(g.error)}</p>}
          <div className="flex gap-2">
            {g.state === "active" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act(g.id, "revoke")}
              >
                {t("tandem.localFiles.revoke")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(g.id, "forget")}
            >
              {t("tandem.localFiles.forget")}
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
export function LocalFileGrantMonitor({ userId }: { userId: string | null }) {
  useEffect(() => {
    void window.electronAPI?.localFiles?.reset().catch(() => {});
  }, [userId]);
  useEffect(() => {
    const reset = () => {
      void window.electronAPI?.localFiles?.reset().catch(() => {});
    };
    window.addEventListener("termix:logout", reset);
    return () => {
      window.removeEventListener("termix:logout", reset);
      reset();
    };
  }, []);
  return null;
}
