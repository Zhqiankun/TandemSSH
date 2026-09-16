import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Send, Square } from "lucide-react";
import { Button } from "@/components/button";
import { aiTaskApi } from "@/api/ai-task-api";
import type { AiTaskView } from "@/types/ai-task";
import { AiMessage } from "../AiMessage";

const TERMINAL_PHASES = [
  "completed",
  "completed-with-errors",
  "cancelled",
] as const;

export function AiTaskTranscript({
  run,
  onContinue,
}: {
  run: AiTaskView;
  onContinue?: (message: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const nextBudget = Math.min(64, run.maxTurns + 10);
  const [draft, setDraft] = useState<{
    runId: string;
    questionId: string;
    text: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [continueDraft, setContinueDraft] = useState<{
    runId: string;
    text: string;
  }>();
  const answer =
    draft?.runId === run.id && draft.questionId === run.question?.id
      ? draft.text
      : "";
  const followUp = continueDraft?.runId === run.id ? continueDraft.text : "";
  const canContinue =
    !!onContinue &&
    !run.question &&
    TERMINAL_PHASES.includes(run.phase as (typeof TERMINAL_PHASES)[number]);

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

  const messages = run.messages.filter(
    (message) =>
      message.content.trim() ||
      (message.role === "assistant" && message.status !== "complete"),
  );

  return (
    <section className="tandem-agent-transcript">
      <div className="tandem-agent-run-header">
        <span
          className={
            ["planning", "thinking", "executing"].includes(run.phase)
              ? "tandem-status-dot active"
              : "tandem-status-dot"
          }
          aria-hidden="true"
        />
        <strong>{t("tandem.agent.phases." + run.phase)}</strong>
      </div>

      {run.recoveredFrom && (
        <p className="tandem-task-help">{t("taskRecovery.aiRestored")}</p>
      )}

      <div
        className="tandem-agent-messages"
        aria-live={run.phase === "thinking" ? "polite" : "off"}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={"tandem-agent-message " + message.role}
          >
            <AiMessage
              role={message.role}
              content={
                message.content ||
                (message.status === "streaming"
                  ? t("tandem.agent.thinking")
                  : t("tandem.agent.interrupted"))
              }
              outcome={
                message.status === "interrupted" ? "interrupted" : undefined
              }
            />
          </div>
        ))}
        {!messages.length && run.phase === "planning" && (
          <div className="tandem-agent-thinking" role="status">
            <Loader2 size={14} className="animate-spin" />
            {t("tandem.agent.thinking")}
          </div>
        )}
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
        <div className="tandem-agent-question">
          <form
            className="tandem-ai-input-shell tandem-agent-reply"
            onSubmit={(event) => {
              event.preventDefault();
              const sentAnswer = answer;
              if (!sentAnswer.trim()) return;
              void action(async () => {
                await aiTaskApi.reply(run.id, run.question!.id, sentAnswer);
                setDraft((current) =>
                  current?.runId === run.id &&
                  current.questionId === run.question!.id &&
                  current.text === sentAnswer
                    ? undefined
                    : current,
                );
              });
            }}
          >
            <textarea
              aria-label={run.question.text}
              value={answer}
              onChange={(event) =>
                setDraft({
                  runId: run.id,
                  questionId: run.question!.id,
                  text: event.target.value,
                })
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              required
              maxLength={8000}
              rows={3}
            />
            <div className="tandem-ai-input-footer">
              <span>{t("tandem.agent.enterHint")}</span>
              <Button
                type="submit"
                size="icon"
                disabled={busy || !answer.trim()}
                aria-label={t("tandem.agent.reply")}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {canContinue && (
        <form
          className="tandem-ai-input-shell tandem-agent-reply tandem-agent-continuation"
          onSubmit={(event) => {
            event.preventDefault();
            const sentMessage = followUp;
            if (!sentMessage.trim()) return;
            void (async () => {
              let continued = false;
              await action(async () => {
                continued = await onContinue!(sentMessage.trim());
                if (!continued) throw Error("CONTINUE_FAILED");
              });
              if (continued)
                setContinueDraft((current) =>
                  current?.runId === run.id && current.text === sentMessage
                    ? undefined
                    : current,
                );
            })();
          }}
        >
          <textarea
            aria-label={t("tandem.agent.continueMessage")}
            value={followUp}
            onChange={(event) =>
              setContinueDraft({ runId: run.id, text: event.target.value })
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={busy}
            required
            maxLength={8000}
            rows={3}
            placeholder={t("tandem.agent.continueHint")}
            autoFocus
          />
          <div className="tandem-ai-input-footer">
            <span>{t("tandem.agent.enterHint")}</span>
            <Button
              type="submit"
              size="icon"
              disabled={busy || !followUp.trim()}
              aria-label={t("tandem.agent.continueSend")}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </Button>
          </div>
        </form>
      )}

      <div className="tandem-agent-actions">
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
        {!TERMINAL_PHASES.includes(
          run.phase as (typeof TERMINAL_PHASES)[number],
        ) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void action(() => aiTaskApi.stop(run.id))}
          >
            <Square size={12} />
            {t("tandem.agent.stop")}
          </Button>
        )}
      </div>
    </section>
  );
}
