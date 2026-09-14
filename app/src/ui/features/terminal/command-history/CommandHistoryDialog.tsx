import { historyHasControlCharacters } from "./completion";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/dialog";
import {
  getCommandHistory,
  deleteCommandFromHistory,
  clearCommandHistory,
} from "@/api/command-history-api";
import { copyToClipboard } from "@/lib/clipboard";

export function CommandHistoryDialog({
  hostId,
  hostName,
  canAppend,
  onClose,
  onAppend,
  onDelete,
  onClear,
}: {
  hostId: number;
  hostName: string;
  canAppend: boolean;
  onClose: () => void;
  onAppend: (command: string) => boolean;
  onDelete: (command: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmClear, setConfirmClear] = useState(false),
    [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setRows([]);
    setBusy(false);
    setNotice("");
    setConfirmClear(false);
    setError("");
    setSelected(null);
    void getCommandHistory(hostId)
      .then((data) => {
        if (generation.current === current) setRows(data);
      })
      .catch(() => {
        if (generation.current === current)
          setError("historyDialog.loadFailed");
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current = current + 1;
    };
  }, [hostId, reload]);
  async function mutate(clear: boolean) {
    if (busy || (!clear && selected === null)) return;
    const current = generation.current,
      command = selected;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (clear) await clearCommandHistory(hostId);
      else await deleteCommandFromHistory(hostId, command!);
      if (clear) onClear();
      else onDelete(command!);
      if (generation.current === current) {
        setRows((old) => (clear ? [] : old.filter((row) => row !== command)));
        setSelected(null);
        setConfirmClear(false);
      }
    } catch {
      if (generation.current === current)
        setError("historyDialog.changeFailed");
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  async function copy() {
    if (selected === null) return;
    const current = generation.current;
    setError("");
    setNotice("");
    const ok = await copyToClipboard(selected).catch(() => false);
    if (current === generation.current) {
      if (ok) setNotice("historyDialog.copied");
      else setError("historyDialog.copyFailed");
    }
  }
  const filtered = rows.filter((row) =>
    row.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const unsafe = selected !== null && historyHasControlCharacters(selected);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("historyDialog.title")}</DialogTitle>
          <DialogDescription>
            {hostName} · {t("historyDialog.hint")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <input
            aria-label={t("historyDialog.search")}
            placeholder={t("historyDialog.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 rounded border bg-background px-3 py-2 text-sm"
          />
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={() => setReload((n) => n + 1)}
          >
            {t("historyDialog.refresh")}
          </Button>
        </div>
        {busy && <p role="status">{t("historyDialog.updating")}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {t(notice)}
          </p>
        )}
        <div className="grid min-h-64 gap-3 sm:grid-cols-2">
          <div
            aria-label={t("historyDialog.entries")}
            className="max-h-80 overflow-auto rounded border p-1"
          >
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">
                {t("common.loading")}
              </p>
            ) : filtered.length ? (
              filtered.map((row, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={selected === row}
                  disabled={busy}
                  onClick={() => {
                    setSelected(row);
                    setNotice("");
                  }}
                  className={`block w-full truncate rounded px-3 py-2 text-left font-mono text-sm hover:bg-muted ${selected === row ? "bg-accent text-accent-foreground" : ""}`}
                >
                  {row}
                </button>
              ))
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                {t("historyDialog.empty")}
              </p>
            )}
          </div>
          <textarea
            aria-label={t("historyDialog.preview")}
            readOnly
            value={selected ?? ""}
            className="min-h-64 w-full resize-none rounded border bg-muted/30 p-3 font-mono text-sm"
          />
        </div>
        {unsafe && (
          <p className="text-sm text-amber-500">
            {t("historyDialog.controls")}
          </p>
        )}
        {!canAppend && (
          <p className="text-sm text-muted-foreground">
            {t("historyDialog.sessionChanged")}
          </p>
        )}
        {confirmClear && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-destructive/40 p-3">
            <p className="flex-1 text-sm">{t("historyDialog.clearConfirm")}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmClear(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void mutate(true)}
            >
              {t("historyDialog.confirmClear")}
            </Button>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || loading || !rows.length}
            onClick={() => setConfirmClear(true)}
          >
            {t("historyDialog.clear")}
          </Button>
          <Button
            variant="outline"
            disabled={busy || selected === null}
            onClick={() => void mutate(false)}
          >
            {t("historyDialog.delete")}
          </Button>
          <Button
            variant="outline"
            disabled={busy || selected === null}
            onClick={() => void copy()}
          >
            {t("historyDialog.copy")}
          </Button>
          <Button
            disabled={
              busy || loading || selected === null || unsafe || !canAppend
            }
            onClick={() => {
              if (selected !== null) {
                if (onAppend(selected)) onClose();
                else setError("historyDialog.sessionChanged");
              }
            }}
          >
            {t("historyDialog.append")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
