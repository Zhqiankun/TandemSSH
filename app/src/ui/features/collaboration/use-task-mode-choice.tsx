import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { Button } from "@/components/button";
import type { TaskMode } from "@/types/collaboration-task";
export function useTaskModeChoice() {
  const { t } = useTranslation(),
    [title, setTitle] = useState<string>(),
    [mode, setMode] = useState<TaskMode>("collaborative");
  const groupName = useId();
  const pending = useRef<
    | { resolve: (mode: TaskMode) => void; reject: (error: Error) => void }
    | undefined
  >(undefined);
  const cancel = useCallback(() => {
    pending.current?.reject(new DOMException("Cancelled", "AbortError"));
    pending.current = undefined;
    setTitle(undefined);
  }, []);
  useEffect(
    () => () => {
      pending.current?.reject(new DOMException("Cancelled", "AbortError"));
      pending.current = undefined;
    },
    [],
  );
  const choose = useCallback((label: string) => {
    if (pending.current)
      return Promise.reject(Error("TASK_CHOICE_IN_PROGRESS"));
    setTitle(label);
    return new Promise<TaskMode>((resolve, reject) => {
      pending.current = { resolve, reject };
    });
  }, []);
  const dialog = (
    <Dialog
      open={title !== undefined}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("tandem.legacy.chooseMode")}</DialogTitle>
          <DialogDescription>
            {title} · {t("tandem.legacy.modeHint")}
          </DialogDescription>
        </DialogHeader>
        <label>
          <input
            type="radio"
            name={groupName}
            checked={mode === "collaborative"}
            onChange={() => setMode("collaborative")}
          />
          {t("tandem.collaboration.modes.collaborative")}
        </label>
        <label>
          <input
            type="radio"
            name={groupName}
            checked={mode === "automatic"}
            onChange={() => setMode("automatic")}
          />
          {t("tandem.collaboration.modes.automatic")}
        </label>
        <Button
          onClick={() => {
            const p = pending.current;
            pending.current = undefined;
            setTitle(undefined);
            p?.resolve(mode);
          }}
        >
          {t("tandem.legacy.createTask")}
        </Button>
      </DialogContent>
    </Dialog>
  );
  return { choose, dialog };
}
