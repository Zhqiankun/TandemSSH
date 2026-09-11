import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { aiTaskApi } from "@/api/ai-task-api";
import type { AiTaskView } from "@/types/ai-task";
export function AiTaskTranscript({ run }: { run: AiTaskView }) {
  const { t } = useTranslation();
  const nextBudget = Math.min(64, run.maxTurns + 10);
  const [draft, setDraft] = useState<{
      runId: string;
      questionId: string;
      text: string;
    }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const answer =
    draft?.runId === run.id && draft.questionId === run.question?.id
      ? draft.text
      : "";
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch {
      setError(t("tandem.agent.requestFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tandem-agent-transcript">
      <div className="flex items-center justify-between gap-2">
        <strong>{run.providerLabel}</strong>
        <span className="text-muted-foreground text-[10px]">{run.model}</span>
      </div>
      {run.recoveredFrom && (
        <p className="tandem-task-help">{t("taskRecovery.aiRestored")}</p>
      )}
      <div className="tandem-task-meta">
        <span>{t("tandem.agent.phases." + run.phase)}</span>
        <span>
          {t("tandem.agent.turns", { used: run.turns, max: run.maxTurns })}
        </span>
      </div>
      <div className="tandem-agent-messages">
        {run.messages
          .filter(
            (message) =>
              message.role === "assistant" &&
              (message.content.trim() || message.status !== "complete"),
          )
          .map((message) => (
            <div key={message.id} className="tandem-agent-message">
              <p>
                {message.content ||
                  (message.status === "streaming"
                    ? t("tandem.agent.thinking")
                    : t("tandem.agent.interrupted"))}
              </p>
              {message.status === "interrupted" && !!message.content && (
                <small>{t("tandem.agent.interrupted")}</small>
              )}
            </div>
          ))}
      </div>
      {run.error && (
        <p role="alert" className="tandem-task-error">
          {t("tandem.agent.errors." + run.error, {
            defaultValue: t("tandem.agent.requestFailed"),
          })}
        </p>
      )}
      {error && (
        <p role="alert" className="tandem-task-error">
          {error}
        </p>
      )}
      {run.question && (
        <form
          className="tandem-authorization"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              await aiTaskApi.reply(run.id, run.question!.id, answer);
              setDraft((current) =>
                current?.runId === run.id &&
                current.questionId === run.question!.id &&
                current.text === answer
                  ? undefined
                  : current,
              );
            });
          }}
        >
          <label>
            {run.question.text}
            <textarea
              value={answer}
              onChange={(event) =>
                setDraft({
                  runId: run.id,
                  questionId: run.question!.id,
                  text: event.target.value,
                })
              }
              required
              maxLength={8000}
              rows={3}
            />
          </label>
          <Button type="submit" disabled={busy || !answer.trim()}>
            {t("tandem.agent.reply")}
          </Button>
        </form>
      )}
      {run.error === "MODEL_BUDGET_EXCEEDED" && run.maxTurns < 64 && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void action(() => aiTaskApi.budget(run.id, nextBudget))
          }
        >
          {t("tandem.agent.addBudget", { count: nextBudget - run.maxTurns })}
        </Button>
      )}
      {!["completed", "cancelled"].includes(run.phase) && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void action(() => aiTaskApi.stop(run.id))}
        >
          {t("tandem.agent.stop")}
        </Button>
      )}
    </section>
  );
}
