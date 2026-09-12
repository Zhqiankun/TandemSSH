import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAiConversationPage, type AiConversation } from "@/api/ai-api";
import { Button } from "@/components/button";
export function AiConversationPicker({
  value,
  refreshKey,
  onSelect,
}: {
  value: number | null;
  refreshKey: string;
  onSelect: (id: number | null) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AiConversation[]>([]),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(false),
    [nextCursor, setNextCursor] = useState<string | null>(null);
  const revision = useRef(0);
  const reload = useCallback(async (cursor?: string) => {
    const current = ++revision.current;
    setLoading(true);
    setError(false);
    try {
      const result = await getAiConversationPage(cursor);
      if (current === revision.current) {
        setRows((previous) =>
          cursor
            ? [
                ...previous,
                ...result.conversations.filter(
                  (row) => !previous.some((old) => old.id === row.id),
                ),
              ]
            : result.conversations,
        );
        setNextCursor(result.nextCursor);
      }
    } catch {
      if (current === revision.current) setError(true);
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, []);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  useEffect(() => {
    void reload();
    return invalidate;
  }, [reload, refreshKey, invalidate]);
  return (
    <div className="space-y-1 px-3 pb-2">
      <div className="flex items-center gap-1">
        <select
          aria-label={t("ai.chatHistory")}
          className="h-7 min-w-0 flex-1 border border-border bg-background px-1 text-xs"
          value={value ?? ""}
          onChange={(e) =>
            onSelect(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">{t("ai.newConversation")}</option>
          {value && !rows.some((r) => r.id === value) && (
            <option value={value}>
              {t("ai.chatHistory")} #{value}
            </option>
          )}
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title || `${t("ai.chatHistory")} #${r.id}`}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
          {t("ai.newConversation")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void reload()}
        >
          {t("ai.refreshHistory")}
        </Button>
      </div>
      {nextCursor && (
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void reload(nextCursor)}
        >
          {t("ai.loadOlderConversations")}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t("ai.historyLoadFailed")}
        </p>
      )}
    </div>
  );
}
