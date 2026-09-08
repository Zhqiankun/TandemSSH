import { useTaskModeChoice } from "@/features/collaboration/use-task-mode-choice";
import { legacyErrorCode } from "@/api/legacy-commands-api";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  hasSnippetInputs,
  resolveSnippetContent,
  type SnippetHostContext,
} from "@/lib/snippet-variables";
import { SnippetVariablesDialog } from "@/components/SnippetVariablesDialog";
import type { Snippet, Tab } from "@/types/ui-types";

/**
 * Shared snippet flow for the sidebar and command palette. Executable snippets
 * collect argument data and a task mode, then request a controlled task on each
 * selected terminal. Notes use the manual paste path; task authorization is
 * always handled by the collaboration panel, independent of legacy preferences.
 */
export function useSnippetRunner() {
  const { t } = useTranslation();
  const { choose: chooseMode, dialog: modeDialog } = useTaskModeChoice();
  const { confirmWithToast } = useConfirmation();
  const [runningSnippet, setRunningSnippet] = useState<{
    snippet: Snippet;
    host: SnippetHostContext | null;
    onConfirm: (
      resolvedContent: string,
      inputValues: Record<string, string>,
    ) => void;
  } | null>(null);

  const handleConfirmRun = useCallback(
    (snippet: Snippet, execute: () => void) => {
      const shouldConfirm =
        localStorage.getItem("confirmSnippetExecution") === "true";
      if (!shouldConfirm) {
        execute();
        return;
      }
      confirmWithToast(
        t("newUi.sidebar.snippets.confirmRunMessage", { name: snippet.name }),
        execute,
        t("newUi.sidebar.snippets.confirmRunButton"),
        t("newUi.sidebar.snippets.cancel"),
        { confirmOnEnter: true, duration: 6000 },
      );
    },
    [confirmWithToast, t],
  );

  async function sendResolvedToTerminal(
    tab: Tab,
    snippet: Snippet,
    inputValues: Record<string, string>,
    mode: "automatic" | "collaborative",
  ) {
    if (snippet.isNote) {
      const content = resolveSnippetContent(
        snippet.content,
        tab.host ?? null,
        inputValues,
      );
      const paste = tab.terminalRef?.current?.paste;
      if (!paste) throw Error("SHARED_SESSION_REQUIRED");
      paste(content);
      return;
    }
    const terminal = tab.terminalRef?.current;
    if (!terminal?.requestControlledTask)
      throw Error("SHARED_SESSION_REQUIRED");
    await terminal.requestControlledTask(
      {
        kind: "snippet",
        title: snippet.name,
        content: snippet.content,
        inputs: inputValues,
      },
      { mode },
    );
  }
  const runSnippet = useCallback(
    (snippet: Snippet, targets: Tab[]) => {
      const runWithInputs = (inputValues: Record<string, string>) => {
        const doSend = async () => {
          let mode: "automatic" | "collaborative" = "collaborative";
          if (!snippet.isNote) {
            try {
              mode = await chooseMode(snippet.name);
            } catch {
              return;
            }
          }
          const results = await Promise.allSettled(
            targets.map((tab) =>
              sendResolvedToTerminal(tab, snippet, inputValues, mode),
            ),
          );
          const ok = results.filter(
            (result) => result.status === "fulfilled",
          ).length;
          if (ok)
            toast.info(
              t(
                snippet.isNote
                  ? "newUi.sidebar.snippets.pasteSuccess"
                  : "tandem.legacy.tasksCreated",
                { name: snippet.name, count: ok },
              ),
            );
          for (const result of results)
            if (result.status === "rejected")
              toast.error(
                t("tandem.legacy.errors." + legacyErrorCode(result.reason), {
                  defaultValue: t("tandem.legacy.failed"),
                }),
              );
        };
        if (snippet.isNote) {
          if (/[\r\n]/.test(snippet.content))
            confirmWithToast(
              t("tandem.legacy.notePaste"),
              () => {
                void doSend();
              },
              t("common.confirm"),
              t("common.cancel"),
              { confirmOnEnter: false },
            );
          else void doSend();
        } else {
          void doSend();
        }
      };

      if (
        hasSnippetInputs(snippet.content) ||
        (snippet.isNote && /[\r\n]/.test(snippet.content))
      ) {
        setRunningSnippet({
          snippet,
          host: targets[0]?.host ?? null,
          onConfirm: (_resolvedContent, inputValues) => {
            setRunningSnippet(null);
            runWithInputs(inputValues);
          },
        });
      } else {
        runWithInputs({});
      }
    },
    [confirmWithToast, chooseMode, t],
  );

  const variablesDialog = runningSnippet ? (
    <SnippetVariablesDialog
      snippet={runningSnippet.snippet}
      host={runningSnippet.host}
      onCancel={() => setRunningSnippet(null)}
      onConfirm={runningSnippet.onConfirm}
    />
  ) : null;

  return {
    runSnippet,
    handleConfirmRun,
    dialog: (
      <>
        {variablesDialog}
        {modeDialog}
      </>
    ),
  };
}
