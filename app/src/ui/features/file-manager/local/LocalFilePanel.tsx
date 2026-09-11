import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Folder,
  FolderOpen,
  File,
  Link,
  HardDrive,
  RefreshCw,
  Search,
} from "lucide-react";
import { createFileModifiedFormatter } from "../file-manager-utils";
import { Button } from "@/components/button";
import type {
  LocalBrowserEntry,
  LocalBrowserRoot,
  LocalBrowserPage,
  LocalBrowserOptions,
  LocalBrowserSelection,
  LocalBrowserTarget,
} from "@/types/local-file-browser";
import type { DownloadNativeResult } from "@/types/file-download";
function value<T>(result: DownloadNativeResult<T>): T {
  if (result.ok === false) throw Error(result.error);
  return result.value;
}
function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const unit = n < 1024 ** 2 ? "KiB" : n < 1024 ** 3 ? "MiB" : "GiB";
  return `${(n / (unit === "KiB" ? 1024 : unit === "MiB" ? 1024 ** 2 : 1024 ** 3)).toFixed(1)} ${unit}`;
}
export function LocalFilePanel({
  onTargetChange,
  onUpload,
  canUpload,
  targetLabel,
}: {
  onTargetChange: (target: LocalBrowserTarget | null) => void;
  onUpload: (selection: LocalBrowserSelection) => void;
  canUpload: boolean;
  targetLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const formatModified = useMemo(
    () => createFileModifiedFormatter(i18n.resolvedLanguage ?? i18n.language),
    [i18n.resolvedLanguage, i18n.language],
  );
  const api = window.electronAPI?.localBrowser;
  const [root, setRoot] = useState<LocalBrowserRoot | null>(null);
  const [relative, setRelative] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [options, setOptions] = useState<LocalBrowserOptions>({
    sort: "name",
    order: "asc",
    offset: 0,
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<LocalBrowserPage | null>(null);
  const [selected, setSelected] = useState<Record<string, LocalBrowserEntry>>(
    {},
  );
  const [busy, setBusy] = useState(false),
    [choosing, setChoosing] = useState(false),
    [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const listing = useRef<Promise<unknown>>(Promise.resolve());
  const owned = useRef<LocalBrowserRoot | null>(null),
    alive = useRef(true),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    const counter = generation;
    return () => {
      alive.current = false;
      counter.current++;
      const current = owned.current;
      owned.current = null;
      if (current) void api?.release(current.id);
    };
  }, [api]);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setOptions((previous) =>
          (previous.search ?? "") === search
            ? previous
            : { ...previous, search, offset: 0 },
        ),
      180,
    );
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!root || !api) return;
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setPage(null);
    setSelected({});
    const work = listing.current
      .catch(() => {})
      .then(async () => {
        if (!alive.current || current !== generation.current) return undefined;
        return value(await api.list(root.id, relative, options));
      });
    listing.current = work;
    void work
      .then((result) => {
        if (!result || !alive.current || current !== generation.current) return;
        setPage(result);
        setPathInput(result.path);
      })
      .catch((e) => {
        if (alive.current && current === generation.current)
          setError(e instanceof Error ? e.message : "LOCAL_IO_FAILED");
      })
      .finally(() => {
        if (alive.current && current === generation.current) setBusy(false);
      });
  }, [api, root, relative, options, refresh]);
  useEffect(() => {
    onTargetChange(
      page
        ? {
            rootId: page.rootId,
            relativePath: page.relativePath,
            path: page.path,
          }
        : null,
    );
  }, [page, onTargetChange]);
  async function choose() {
    if (!api) return;
    setChoosing(true);
    setError("");
    try {
      const next = value(await api.choose());
      if (!next) return;
      if (!alive.current) {
        await api.release(next.id);
        return;
      }
      const old = owned.current;
      owned.current = next;
      generation.current++;
      setPage(null);
      setRoot(next);
      setRelative("");
      setPathInput(next.path);
      setHistory([]);
      setOptions((previous) => ({ ...previous, offset: 0 }));
      if (old) await api.release(old.id);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "LOCAL_IO_FAILED");
    } finally {
      if (alive.current) setChoosing(false);
    }
  }
  function navigate(next: string, back = false) {
    if (next === relative) {
      setRefresh((n) => n + 1);
      return;
    }
    setHistory((previous) =>
      back ? previous.slice(0, -1) : [...previous.slice(-49), relative],
    );
    setRelative(next);
    setOptions((previous) => ({ ...previous, offset: 0 }));
  }
  function goPath() {
    if (!root) return;
    const input = pathInput.trim().replaceAll("\\", "/"),
      base = root.path.replaceAll("\\", "/").replace(/\/$/, "");
    const lower = input.toLowerCase(),
      prefix = base.toLowerCase();
    if (lower === prefix || lower === prefix + "/") navigate("");
    else if (lower.startsWith(prefix + "/"))
      navigate(input.slice(base.length + 1).replace(/\/$/, ""));
    else if (!/^(?:[a-z]:|\/)/i.test(input)) navigate(input.replace(/\/$/, ""));
    else setError("LOCAL_PATH_INVALID");
  }
  const chosen = Object.values(selected),
    single = chosen.length === 1 ? chosen[0] : undefined;
  const rows = page?.entries ?? [],
    selectable = rows.filter(
      (e) => !e.error && ["file", "directory"].includes(e.kind),
    );
  const text = (name: string) => t("tandem.localBrowser." + name);
  return (
    <section
      aria-label={text("title")}
      className="flex min-h-0 min-w-0 flex-col border border-border bg-card"
    >
      <header className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide">
          <HardDrive className="size-4 text-primary" />
          {text("title")}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={choosing || !api}
          onClick={() => void choose()}
        >
          <FolderOpen className="size-3.5" />
          {text(root ? "change" : "choose")}
        </Button>
      </header>
      {!root ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <FolderOpen className="size-9 text-muted-foreground/60" />
          <p className="text-sm">{text("empty")}</p>
          <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
            {text("hint")}
          </p>
          <Button
            size="sm"
            disabled={choosing || !api}
            onClick={() => void choose()}
          >
            {text("choose")}
          </Button>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {t("tandem.localBrowser.errors." + error, {
                defaultValue: text("failed"),
              })}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 border-b border-border p-2">
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label={text("back")}
              disabled={!history.length || busy}
              onClick={() => navigate(history[history.length - 1], true)}
            >
              <ArrowLeft className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label={text("parent")}
              disabled={!relative || busy}
              onClick={() =>
                navigate(relative.split("/").slice(0, -1).join("/"))
              }
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <form
              className="min-w-0 flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                goPath();
              }}
            >
              <input
                aria-label={text("path")}
                className="h-7 w-full min-w-0 rounded-sm border border-input bg-background px-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
              />
            </form>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label={text("refresh")}
              disabled={busy}
              onClick={() => setRefresh((n) => n + 1)}
            >
              <RefreshCw
                className={busy ? "size-3.5 animate-spin" : "size-3.5"}
              />
            </Button>
          </div>
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              aria-label={text("search")}
              placeholder={text("search")}
              className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={!!options.showHidden}
                onChange={(e) =>
                  setOptions((previous) => ({
                    ...previous,
                    showHidden: e.target.checked,
                    offset: 0,
                  }))
                }
              />
              {text("hidden")}
            </label>
          </div>
          {error && (
            <p
              role="alert"
              className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              {t("tandem.localBrowser.errors." + error, {
                defaultValue: text("failed"),
              })}
            </p>
          )}
          {page?.attributeWarning && (
            <p
              role="status"
              className="border-b border-border px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
            >
              {text("attributeWarning")}
            </p>
          )}
          {page?.truncated && (
            <p
              role="status"
              className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
            >
              {text("truncated")}
            </p>
          )}
          <div className="min-h-24 flex-1 overflow-auto" aria-busy={busy}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={text("selectPage")}
                      disabled={!selectable.length}
                      checked={
                        !!selectable.length &&
                        selectable.every((e) => !!selected[e.relativePath])
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? Object.fromEntries(
                                selectable.map((item) => [
                                  item.relativePath,
                                  item,
                                ]),
                              )
                            : {},
                        )
                      }
                    />
                  </th>
                  {(["name", "size", "modifiedAt"] as const).map((sort) => (
                    <th key={sort} className="px-2 py-2 text-left font-medium">
                      <button
                        onClick={() =>
                          setOptions((previous) => ({
                            ...previous,
                            sort,
                            order:
                              previous.sort === sort &&
                              previous.order !== "desc"
                                ? "desc"
                                : "asc",
                            offset: 0,
                          }))
                        }
                      >
                        {text(sort)}
                        {options.sort === sort
                          ? options.order === "desc"
                            ? " ↓"
                            : " ↑"
                          : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr
                    key={entry.relativePath}
                    className={`border-b border-border/40 ${selected[entry.relativePath] ? "bg-primary/10" : "hover:bg-muted/50"}`}
                    onDoubleClick={() => {
                      if (entry.kind === "directory" && !entry.error)
                        navigate(entry.relativePath);
                    }}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={t("tandem.localBrowser.select", {
                          name: entry.name,
                        })}
                        checked={!!selected[entry.relativePath]}
                        disabled={
                          !!entry.error ||
                          !["file", "directory"].includes(entry.kind)
                        }
                        onChange={(e) =>
                          setSelected((previous) => {
                            const next = { ...previous };
                            if (e.target.checked)
                              next[entry.relativePath] = entry;
                            else delete next[entry.relativePath];
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="max-w-56 px-2 py-2">
                      <span
                        className="flex items-center gap-2"
                        title={entry.name}
                      >
                        {entry.kind === "directory" ? (
                          <Folder className="size-3.5 shrink-0 text-primary" />
                        ) : entry.kind === "link" ? (
                          <Link className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <File className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <button
                          className="truncate text-left"
                          disabled={entry.kind !== "directory" || !!entry.error}
                          onClick={() => navigate(entry.relativePath)}
                        >
                          {entry.name}
                        </button>
                      </span>
                      {entry.error && (
                        <span className="text-destructive">
                          {text("unavailable")}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">
                      {entry.kind === "directory" ? "—" : bytes(entry.size)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">
                      {formatModified({
                        modifiedTimestamp: entry.modifiedAt / 1000,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p
                role="status"
                className="px-4 py-8 text-center text-xs text-muted-foreground"
              >
                {text(busy ? "loading" : error ? "unavailable" : "noFiles")}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span>
              {t("tandem.localBrowser.count", { count: page?.total ?? 0 })}
            </span>
            <div className="flex gap-2">
              <button
                disabled={!page || !page.offset || busy}
                onClick={() =>
                  setOptions((previous) => ({
                    ...previous,
                    offset: Math.max(0, (page?.offset ?? 0) - 200),
                  }))
                }
              >
                {text("previous")}
              </button>
              <button
                disabled={!page || page.nextOffset === null || busy}
                onClick={() =>
                  setOptions((previous) => ({
                    ...previous,
                    offset: page?.nextOffset ?? 0,
                  }))
                }
              >
                {text("next")}
              </button>
            </div>
          </div>
          {single && (
            <dl
              aria-label={text("properties")}
              className="space-y-1 border-t border-border bg-muted/20 px-3 py-2 text-xs"
            >
              <dt className="font-medium">{text("properties")}</dt>
              <dd className="break-all font-mono text-muted-foreground">
                {root.path.replace(/[\\/]$/, "")}/{single.relativePath}
              </dd>
              <dd className="text-muted-foreground">
                {text(single.kind)} · {bytes(single.size)}
                {single.hidden ? " · " + text("hiddenAttribute") : ""}
                {single.system ? " · " + text("systemAttribute") : ""}
                {single.readOnly ? " · " + text("readOnlyAttribute") : ""}
                {single.attributesKnown === false
                  ? " · " + text("unknownAttributes")
                  : ""}
              </dd>
            </dl>
          )}
          <footer className="space-y-1.5 border-t border-border p-2">
            <p
              className="truncate px-1 text-[11px] text-muted-foreground"
              title={targetLabel}
            >
              {text("to")} {targetLabel}
            </p>
            <Button
              className="w-full"
              size="sm"
              disabled={!canUpload || !chosen.length || busy || !page}
              onClick={() =>
                onUpload({
                  rootId: root.id,
                  entries: chosen.map(({ relativePath, version }) => ({
                    relativePath,
                    version,
                  })),
                })
              }
            >
              <ArrowUpRight className="size-3.5" />
              {t("tandem.localBrowser.upload", { count: chosen.length })}
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}
