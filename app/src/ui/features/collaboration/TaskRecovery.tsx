import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { taskRecoveryApi } from "@/api/task-recovery-api";
import { collaborationErrorCode } from "@/api/collaboration-api";
import type { TaskView } from "@/types/collaboration-task";
import type {
  TaskRecoveryDetail,
  TaskRecoverySummary,
} from "@/types/task-recovery";
import { TaskPlanLine } from "./TaskPlanLine";
export function TaskRecovery({
  sessionId,
  task,
  onRestored,
}: {
  sessionId: string;
  task?: TaskView;
  onRestored: (task: TaskView) => void;
}) {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false),
    [rows, setRows] = useState<TaskRecoverySummary[]>([]),
    [detail, setDetail] = useState<TaskRecoveryDetail>(),
    [reviewed, setReviewed] = useState(false),
    [reconciliation, setReconciliation] = useState<"retry" | "skip" | "">(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [saved, setSaved] = useState(false),
    [remove, setRemove] = useState(false),
    pending = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const refresh = async () => setRows(await taskRecoveryApi.list());
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(collaborationErrorCode(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const row = detail?.summary;
  return (
    <>
      {task &&
        !task.activeWorkflowRunId &&
        !["completed", "completed-with-errors", "cancelled"].includes(
          task.state,
        ) && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setOpen(true);
                setSaved(false);
                await taskRecoveryApi.save(task.id);
                setSaved(true);
                setOpen(true);
                await refresh();
              })
            }
          >
            {t("taskRecovery.save")}
          </Button>
        )}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setOpen(true);
          void run(refresh);
        }}
      >
        {t("taskRecovery.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!pending.current) {
            setOpen(v);
            if (!v) {
              setDetail(undefined);
              setSaved(false);
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("taskRecovery.title")}</DialogTitle>
            <DialogDescription>{t("taskRecovery.hint")}</DialogDescription>
          </DialogHeader>
          {busy && <p role="status">{t("taskRecovery.busy")}</p>}
          {saved && <p role="status">{t("taskRecovery.saved")}</p>}
          {error && (
            <p role="alert" className="text-amber-500">
              {t("taskRecovery.errors." + error, {
                defaultValue: t("tandem.collaboration.errors." + error, {
                  defaultValue: t("taskRecovery.failed"),
                }),
              })}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            {t("common.refresh")}
          </Button>
          {!busy && !rows.length && <p>{t("taskRecovery.empty")}</p>}
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              aria-pressed={row?.id === r.id}
              className="w-full rounded border border-border p-3 text-left text-sm aria-pressed:border-primary"
              onClick={() =>
                void run(async () => {
                  setDetail(undefined);
                  setReviewed(false);
                  setReconciliation("");
                  setRemove(false);
                  setDetail(await taskRecoveryApi.detail(r.id));
                })
              }
            >
              <strong>{r.title}</strong>
              <span className="float-right">
                {t("taskRecovery.states." + r.state)}
              </span>
              <span className="block break-all">{r.hostName}</span>
              <span className="block">
                {t("taskRecovery.progress", {
                  done: r.nextStep,
                  total: r.stepCount,
                })}{" "}
                · {t("tandem.collaboration.modes." + r.mode)}
              </span>
            </button>
          ))}
          {detail && row && (
            <section className="border-t border-border pt-3 space-y-3">
              {detail.ai && (
                <div className="rounded border border-border p-3 space-y-2 text-sm">
                  <strong>
                    {detail.ai.providerLabel} · {detail.ai.model}
                  </strong>
                  <p>
                    {t("tandem.agent.turns", {
                      used: detail.ai.turns,
                      max: detail.ai.maxTurns,
                    })}
                  </p>
                  <p>{t("taskRecovery.aiHint")}</p>
                  {detail.ai.question && (
                    <p>
                      {t("taskRecovery.aiQuestion")}: {detail.ai.question.text}
                    </p>
                  )}
                  <details>
                    <summary>{t("taskRecovery.aiConversation")}</summary>
                    <div className="max-h-64 overflow-auto space-y-3">
                      {detail.ai.messages.map((m) => (
                        <div key={m.id} className="border-b border-border pb-2">
                          <strong>
                            {t(
                              m.role === "user"
                                ? "taskRecovery.aiUser"
                                : "taskRecovery.aiAssistant",
                            )}
                          </strong>
                          <p className="whitespace-pre-wrap break-all">
                            {m.content}
                          </p>
                          {m.status === "interrupted" && (
                            <small>{t("tandem.agent.interrupted")}</small>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
              <h3>{t("taskRecovery.plan")}</h3>
              <ol className="space-y-2">
                {detail.steps.map((step, i) => (
                  <li key={i} className="text-xs flex gap-2">
                    <span>
                      {i + 1}.{" "}
                      {i < row.nextStep
                        ? t("taskRecovery.done")
                        : t("taskRecovery.pending")}
                    </span>
                    <TaskPlanLine step={step} />
                  </li>
                ))}
              </ol>
              <details>
                <summary>{t("taskRecovery.previous")}</summary>
                {detail.operations.map((op) => (
                  <div
                    key={op.id}
                    className="border-b border-border py-2 text-xs"
                  >
                    <code className="whitespace-pre-wrap break-all">
                      {JSON.stringify(op.action)}
                    </code>
                    <p>{t("tandem.collaboration.operations." + op.status)}</p>
                    {op.output && (
                      <pre className="whitespace-pre-wrap break-all">
                        {op.output}
                      </pre>
                    )}
                  </div>
                ))}
              </details>
              {row.resourceRecoveryRequired && (
                <p>{t("taskRecovery.resources")}</p>
              )}
              {row.source === "mcp" && <p>{t("taskRecovery.external")}</p>}
              {["available", "interrupted"].includes(row.state) &&
                row.source !== "mcp" &&
                !row.resourceRecoveryRequired && (
                  <>
                    {row.reconciliationRequired && (
                      <fieldset className="space-y-2 text-sm">
                        <legend>{t("taskRecovery.reconcile")}</legend>
                        {(["retry", "skip"] as const).map((choice) => (
                          <label className="flex gap-2" key={choice}>
                            <input
                              type="radio"
                              name="task-recovery-reconcile"
                              checked={reconciliation === choice}
                              disabled={busy}
                              onChange={() => setReconciliation(choice)}
                            />
                            {t("taskRecovery." + choice)}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      {t("taskRecovery.review")}
                    </label>
                    <Button
                      size="sm"
                      disabled={
                        busy ||
                        !reviewed ||
                        (row.reconciliationRequired && !reconciliation)
                      }
                      onClick={() =>
                        void run(async () => {
                          const next = await taskRecoveryApi.restore(
                            row.id,
                            sessionId,
                            reconciliation || undefined,
                          );
                          if (live.current) onRestored(next);
                          setOpen(false);
                          setDetail(undefined);
                        })
                      }
                    >
                      {t("taskRecovery.restore")}
                    </Button>
                  </>
                )}
              {row.state !== "claimed" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRemove(true)}
                  >
                    {t("taskRecovery.remove")}
                  </Button>
                  {remove && (
                    <div>
                      <p>{t("taskRecovery.removeHint")}</p>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await taskRecoveryApi.remove(row.id);
                            setDetail(undefined);
                            await refresh();
                          })
                        }
                      >
                        {t("taskRecovery.confirmRemove")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
