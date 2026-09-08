import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Settings2 } from "lucide-react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { getAiProviders, getAiStatus, type AiProvider } from "@/api/ai-api";
import { saveUserPreferences } from "@/main-axios";
import { notifyAiStatusChanged } from "@/hooks/use-ai-availability";
import { AiProviderSettings } from "../AiProviderSettings";
import { aiTaskApi } from "@/api/ai-task-api";
import type { TaskMode, TaskView } from "@/types/collaboration-task";
export function AiTaskComposer({
  sessionId,
  onCreate,
}: {
  sessionId: string;
  onCreate: (action: () => Promise<TaskView>) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [maxTurns, setMaxTurns] = useState(20);
  const [providers, setProviders] = useState<AiProvider[]>([]),
    [providerId, setProviderId] = useState<number>(),
    [model, setModel] = useState(""),
    [goal, setGoal] = useState(""),
    [mode, setMode] = useState<TaskMode>("collaborative"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [error, setError] = useState("");
  const selectedId = useRef(providerId);
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
  return (
    <>
      <form
        className="tandem-task-form"
        onSubmit={(event) => {
          event.preventDefault();
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
                })
              ).task;
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        {error && (
          <p role="alert" className="tandem-task-error">
            {t(error)}
          </p>
        )}
        <div className="flex items-center justify-between">
          <strong>{t("tandem.agent.byok")}</strong>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={14} />
            {t("tandem.agent.models")}
          </Button>
        </div>
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
                providers.find((provider) => provider.id === id)
                  ?.defaultModel ?? "",
              );
            }}
          >
            <option value="" disabled>
              {t("tandem.agent.chooseProvider")}
            </option>
            {providers
              .filter((provider) => provider.enabled)
              .map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
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
          {t("tandem.agent.goal")}
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            required
            rows={5}
            maxLength={8000}
            placeholder={t("tandem.agent.goalHint")}
          />
        </label>
        <fieldset className="tandem-mode-select">
          <legend>{t("tandem.collaboration.mode")}</legend>
          {(["collaborative", "automatic"] as const).map((value) => (
            <label key={value} className={mode === value ? "selected" : ""}>
              <input
                type="radio"
                name="agent-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <strong>{t("tandem.collaboration.modes." + value)}</strong>
              <small>{t("tandem.collaboration.modeHints." + value)}</small>
            </label>
          ))}
        </fieldset>
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
        <p className="tandem-task-help">{t("tandem.agent.consent")}</p>
        <Button
          type="submit"
          disabled={
            loading || busy || !providerId || !model.trim() || !goal.trim()
          }
        >
          <Sparkles size={14} />
          {t("tandem.agent.plan")}
        </Button>
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
