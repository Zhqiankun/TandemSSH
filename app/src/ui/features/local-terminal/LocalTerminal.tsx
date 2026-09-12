import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { useXTerm } from "react-xtermjs";
import { useTheme } from "@/components/theme-provider";
import { resolveTermixThemeColors } from "@/features/terminal/terminal-theme";
import { DEFAULT_TERMINAL_CONFIG, TERMINAL_FONTS } from "@/lib/terminal-themes";
import { ensureTerminalFontsLoaded } from "@/features/terminal/terminal-global-styles";

export function LocalTerminal({
  instanceId,
  isVisible,
}: {
  instanceId: string;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const { theme: appTheme } = useTheme();
  const { instance: terminal, ref: xtermRef } = useXTerm();
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  type Shell = "default" | "wsl" | "cmd";
  const [shell, setShell] = useState<Shell>("default");
  const [cwd, setCwd] = useState("");
  const [launch, setLaunch] = useState({
    shell: "default" as Shell,
    cwd: "",
    revision: 0,
  });
  const [phase, setPhase] = useState<
    "starting" | "running" | "exited" | "error"
  >("starting");
  const [info, setInfo] = useState<{ shell: string; cwd: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    window.electronAPI?.getPlatform().then((platform) => {
      setIsWindows(platform === "win32");
    });
  }, []);

  const fit = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const sessionId = sessionIdRef.current;
    if (!terminal || !fitAddon) return;
    fitAddon.fit();
    if (sessionId) {
      window.electronAPI.resizeLocalTerminal(
        sessionId,
        terminal.cols,
        terminal.rows,
      );
    }
  }, [terminal]);

  useEffect(() => {
    if (!terminal) return;
    const colors = resolveTermixThemeColors("termix", appTheme);
    const font = TERMINAL_FONTS.find(
      (item) => item.value === DEFAULT_TERMINAL_CONFIG.fontFamily,
    );
    ensureTerminalFontsLoaded(font?.value ?? TERMINAL_FONTS[0].value);
    terminal.options.theme = colors;
    terminal.options.fontFamily = font?.fallback ?? TERMINAL_FONTS[0].fallback;
    terminal.options.fontSize = DEFAULT_TERMINAL_CONFIG.fontSize;
  }, [appTheme, terminal]);

  useEffect(() => {
    if (!terminal || !window.electronAPI?.isElectron) return;
    terminal.reset();
    setInfo(null);
    setError("");
    setPhase("starting");
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    fitAddon.fit();

    let disposed = false;
    let removeData = () => {};
    let removeExit = () => {};
    const input = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) window.electronAPI.writeLocalTerminal(sessionId, data);
    });

    window.electronAPI
      .startLocalTerminal({
        cols: terminal.cols,
        rows: terminal.rows,
        shell: launch.shell,
        cwd: launch.cwd || undefined,
      })
      .then(({ sessionId, shell: actualShell, cwd: actualCwd }) => {
        if (disposed) {
          window.electronAPI.closeLocalTerminal(sessionId);
          return;
        }
        sessionIdRef.current = sessionId;
        setInfo({ shell: actualShell, cwd: actualCwd });
        setPhase("running");
        removeData = window.electronAPI.onLocalTerminalData(sessionId, (data) =>
          terminal.write(data),
        );
        removeExit = window.electronAPI.onLocalTerminalExit(
          sessionId,
          (exitCode) => {
            if (disposed || sessionIdRef.current !== sessionId) return;
            sessionIdRef.current = null;
            setPhase("exited");
            terminal.write(
              `\r\n\x1b[33m${tRef.current("localTerminal.processExited", { code: exitCode })}\x1b[0m\r\n`,
            );
          },
        );
        return window.electronAPI.readyLocalTerminal(sessionId);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const raw = error instanceof Error ? error.message : String(error);
        const key = raw.includes("LOCAL_TERMINAL_DIRECTORY_UNAVAILABLE")
          ? "localTerminal.directoryUnavailable"
          : raw.includes("LOCAL_TERMINAL_INVALID_DIRECTORY")
            ? "localTerminal.invalidDirectory"
            : raw.includes("LOCAL_TERMINAL_INVALID_SHELL")
              ? "localTerminal.invalidShell"
              : "localTerminal.startFailed";
        const message = tRef.current(key, { detail: raw });
        setError(message);
        setPhase("error");
        terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
      });

    const observer = new ResizeObserver(() => fit());
    if (xtermRef.current) observer.observe(xtermRef.current);
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      removeData();
      removeExit();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) window.electronAPI.closeLocalTerminal(sessionId);
      fitAddonRef.current = null;
      fitAddon.dispose();
    };
  }, [fit, instanceId, launch, terminal, xtermRef]);

  useEffect(() => {
    if (isVisible) requestAnimationFrame(fit);
  }, [fit, isVisible]);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0 border border-accent-brand/40 px-2 py-1 font-semibold text-accent-brand">
            {t("localTerminal.localBadge")}
          </span>
          <span
            className="min-w-0 truncate text-muted-foreground"
            title={info ? info.shell + " · " + info.cwd : undefined}
          >
            {info
              ? info.shell +
                " · " +
                t("localTerminal.startedAt", { path: info.cwd })
              : t("localTerminal.localOnly")}
          </span>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setLaunch({ shell, cwd, revision: launch.revision + 1 });
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("localTerminal.shell")}
            <select
              aria-label={t("localTerminal.shell")}
              className="h-8 rounded-none border border-border bg-background px-2 text-foreground"
              value={shell}
              onChange={(event) => setShell(event.target.value as Shell)}
            >
              <option value="default">{t("localTerminal.defaultShell")}</option>
              {isWindows && (
                <>
                  <option value="cmd">CMD</option>
                  <option value="wsl">WSL</option>
                </>
              )}
            </select>
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            {t("localTerminal.cwd")}
            <input
              aria-label={t("localTerminal.cwd")}
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder={t("localTerminal.homePlaceholder")}
              className="h-8 rounded-none border border-border bg-background px-2 text-xs text-foreground"
            />
          </label>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={phase === "starting"}
          >
            {t(
              phase === "starting"
                ? "localTerminal.starting"
                : phase === "running"
                  ? "localTerminal.restart"
                  : "localTerminal.start",
            )}
          </Button>
        </form>
        {phase === "running" && (
          <p className="text-xs text-muted-foreground">
            {t("localTerminal.restartHint")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div ref={xtermRef} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
