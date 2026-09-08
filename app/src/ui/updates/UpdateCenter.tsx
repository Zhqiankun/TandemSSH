import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import type { AppUpdateSnapshot } from "@/types/app-update";
export function DesktopUpdateButton() {
  const { t } = useTranslation();
  if (!window.electronAPI?.updates) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="w-fit h-6 px-2 text-[10px]"
      onClick={() => window.dispatchEvent(new Event("tandem-open-updates"))}
    >
      {t("tandem.updates.button")}
    </Button>
  );
}
export function UpdateCenter() {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false),
    [state, setState] = useState<AppUpdateSnapshot>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const notifiedVersion = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      state?.status !== "available" ||
      !state.latestVersion ||
      notifiedVersion.current === state.latestVersion
    )
      return;
    notifiedVersion.current = state.latestVersion;
    if (!open)
      toast.info(
        t("tandem.updates.availableNotice", { version: state.latestVersion }),
        {
          action: {
            label: t("tandem.updates.view"),
            onClick: () => setOpen(true),
          },
        },
      );
  }, [state?.status, state?.latestVersion, open, t]);
  const api = window.electronAPI?.updates;
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("tandem-open-updates", show);
    return () => window.removeEventListener("tandem-open-updates", show);
  }, []);
  useEffect(() => {
    if (!api) return;
    let stopped = false,
      polling = false;
    const read = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await api.action("status");
        if (!stopped && result.ok) setState(result.value);
      } finally {
        polling = false;
      }
    };
    void read().catch(() => {});
    const timer = setInterval(
      () => void read().catch(() => {}),
      open ? 500 : 3000,
    );
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [api, open]);
  useEffect(() => {
    if (!api || localStorage.getItem("disableUpdateCheck") === "true") return;
    const timer = setTimeout(() => {
      void api
        .action("check")
        .then((result) => {
          if (result.ok) setState(result.value);
        })
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [api]);
  if (!api) return null;
  const act = async (
    action: "check" | "download" | "cancel" | "install" | "open",
  ) => {
    if (busy && action !== "cancel") return;
    if (action !== "cancel") setBusy(true);
    setError(undefined);
    try {
      const result = await api.action(action);
      if (result.ok === true) setState(result.value);
      else setError(result.error);
    } catch {
      setError("UPDATE_FAILED");
    } finally {
      if (action !== "cancel") setBusy(false);
    }
  };
  const code = error ?? state?.error;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("tandem.updates.title")}</DialogTitle>
          <DialogDescription>
            {t("tandem.updates.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            {t("tandem.updates.current", {
              version: state?.currentVersion ?? "—",
            })}
          </p>
          {state?.latestVersion && (
            <p>
              {t("tandem.updates.latest", { version: state.latestVersion })}
            </p>
          )}
          <p role="status">
            {t("tandem.updates.states." + (state?.status ?? "idle"))}
          </p>
          {state?.progress && (
            <>
              <progress
                className="w-full"
                max={100}
                value={state.progress.percent}
                aria-label={t("tandem.updates.progress")}
              />
              <p>
                {t("tandem.updates.progressText", {
                  percent: state.progress.percent,
                  transferred: Math.round(state.progress.transferred / 1048576),
                  total: Math.round(state.progress.total / 1048576),
                })}
              </p>
            </>
          )}
          {state && !state.installed && (
            <p>{t("tandem.updates.installerHint")}</p>
          )}
          {code && (
            <p role="alert" className="text-amber-500">
              {t("tandem.updates.errors." + code, {
                defaultValue: t("tandem.updates.failed"),
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={
              busy ||
              ["downloading", "installing"].includes(state?.status ?? "")
            }
            onClick={() => void act("check")}
          >
            {t("tandem.updates.check")}
          </Button>
          {state?.installed && state.status === "available" && (
            <Button disabled={busy} onClick={() => void act("download")}>
              {t("tandem.updates.download")}
            </Button>
          )}
          {state?.status === "downloading" && (
            <Button variant="outline" onClick={() => void act("cancel")}>
              {t("tandem.updates.cancel")}
            </Button>
          )}
          {state?.status === "downloaded" && (
            <Button disabled={busy} onClick={() => void act("install")}>
              {t("tandem.updates.install")}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act("open")}
          >
            {t("tandem.updates.release")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
