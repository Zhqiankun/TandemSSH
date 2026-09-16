import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { getAiProviders, getAiStatus, type AiProvider } from "@/api/ai-api";
import { saveUserPreferences } from "@/main-axios";
import { notifyAiStatusChanged } from "@/hooks/use-ai-availability";
import { AiProviderSettings } from "../AiProviderSettings";
import { aiTaskApi } from "@/api/ai-task-api";
import type { TaskMode, TaskView } from "@/types/collaboration-task";

const SUGGESTIONS = [
  "tandem.agent.suggestionDocker",
  "tandem.agent.suggestionHealth",
  "tandem.agent.suggestionLogs",
] as const;

export function AiTaskComposer({
  sessionId,
  onCreate,
}: {
  sessionId: string;
  onCreate: (action: () => Promise<TaskView>) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [maxTurns, setMaxTurns] = useState(20);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [providerId, setProviderId] = useState<number>();
  const [model, setModel] = useState("");
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<TaskMode>("collaborative");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const selectedId = useRef(providerId);
  const textarea = useRef<HTMLTextAreaElement>(null);
  selectedId.current = providerId;

  const load = useCallback(async (preferred?: number) => {
    const list = await getAiProviders();
    setProviders(list);
    const selected =
      list.find((item) => item.id === (preferred ?? selectedId.current)) ??
      list.find((item) => item.enabled);
    if (selected) {
      setProviderId(selected.id);
      setModel(selected.defaultModel ?? "");
    }
    if (!list.length) setSettings(true);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await getAiStatus();
        if (!status.globallyEnabled) throw Error("AI_DISABLED");
        if (!status.enabled) {
          await saveUserPreferences({ aiAssistantEnabled: true });
          notifyAiStatusChanged();
        }
        if (active) await load();
      } catch {
        if (active) setError("tandem.agent.unavailable");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const provider = providers.find((item) => item.id === providerId);
  const canSend =
    !loading && !busy && !!providerId && !!model.trim() && !!goal.trim();

  return (
    <>
      <form
        className="tandem-ai-composer"
        aria-label={t("tandem.agent.task")}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSend) return;
          setBusy(true);
          void onCreate(async () => {
            try {
              return (
                await aiTaskApi.create({
                  sessionId,
                  requestId: crypto.randomUUID(),
                  providerId: providerId!,
                  model: model.trim(),
                  goal: goal.trim(),
                  mode,
                  maxTurns,
                  autoAuthorizeReadOnly: mode === "collaborative",
                })
              ).task;
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        <div className="tandem-ai-intro">
          <span className="tandem-ai-intro-icon" aria-hidden="true">
            <Sparkles size={17} />
          </span>
          <div>
            <strong>{t("tandem.agent.chatTitle")}</strong>
            <p>{t("tandem.agent.chatHint")}</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="tandem-task-error">
            {t(error)}
          </p>
        )}

        {!goal && !error && (
          <div
            className="tandem-ai-suggestions"
            aria-label={t("tandem.agent.suggestions")}
          >
            {SUGGESTIONS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setGoal(t(key));
                  requestAnimationFrame(() => textarea.current?.focus());
                }}
              >
                {t(key)}
              </button>
            ))}
          </div>
        )}

        <div className="tandem-ai-input-shell">
          <textarea
            ref={textarea}
            value={goal}
            aria-label={t("tandem.agent.goal")}
            onChange={(event) => setGoal(event.target.value)}
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
            rows={5}
            maxLength={8000}
            placeholder={t("tandem.agent.goalHint")}
            autoFocus
          />
          <div className="tandem-ai-input-footer">
            <span
              className="tandem-ai-provider-summary"
              title={
                provider
                  ? t("tandem.agent.modelSummary", {
                      provider: provider.label,
                      model,
                    })
                  : t("tandem.agent.chooseProvider")
              }
            >
              <span aria-hidden="true" />
              {provider?.label ?? t("tandem.agent.chooseProvider")}
              {model ? " · " + model : ""}
            </span>
            <Button
              type="submit"
              size="icon"
              disabled={!canSend}
              aria-label={t("tandem.agent.plan")}
              title={t("tandem.agent.enterHint")}
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
            </Button>
          </div>
        </div>

        <div className="tandem-ai-controls">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={14} />
            {t("tandem.agent.models")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={advanced}
            onClick={() => setAdvanced((value) => !value)}
          >
            <SlidersHorizontal size={14} />
            {t(
              advanced ? "tandem.agent.hideAdvanced" : "tandem.agent.advanced",
            )}
          </Button>
        </div>

        {advanced && (
          <div className="tandem-ai-advanced">
            <fieldset
              className="tandem-ai-mode"
              aria-label={t("tandem.collaboration.mode")}
            >
              {(["collaborative", "automatic"] as const).map((value) => (
                <label key={value} className={mode === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="agent-mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <span>{t("tandem.collaboration.modes." + value)}</span>
                </label>
              ))}
            </fieldset>
            <label>
              {t("tandem.agent.provider")}
              <select
                value={providerId ?? ""}
                disabled={loading}
                required
                onChange={(event) => {
                  const id = Number(event.target.value);
                  setProviderId(id);
                  setModel(
                    providers.find((item) => item.id === id)?.defaultModel ??
                      "",
                  );
                }}
              >
                <option value="" disabled>
                  {t("tandem.agent.chooseProvider")}
                </option>
                {providers
                  .filter((item) => item.enabled)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t("tandem.agent.model")}
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                required
                maxLength={256}
                placeholder={t("tandem.agent.modelHint")}
              />
            </label>
            <label>
              {t("tandem.agent.budget")}
              <input
                type="number"
                min={2}
                max={64}
                required
                value={maxTurns}
                onChange={(event) => setMaxTurns(event.target.valueAsNumber)}
              />
            </label>
          </div>
        )}

        <p className="tandem-task-help tandem-ai-consent">
          {t("tandem.agent.consent")}
        </p>
      </form>

      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("tandem.agent.models")}</DialogTitle>
            <DialogDescription>{t("tandem.agent.byok")}</DialogDescription>
          </DialogHeader>
          <AiProviderSettings
            providers={providers}
            onChanged={(id) => void load(id)}
            onAdded={() => setSettings(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
