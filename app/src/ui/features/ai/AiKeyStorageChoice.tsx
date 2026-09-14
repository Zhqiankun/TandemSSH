import { useTranslation } from "react-i18next";
export function AiKeyStorageChoice({
  memory,
  onChange,
}: {
  memory: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-xs">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={memory}
          onChange={(e) => onChange(e.target.checked)}
        />
        {t("ai.memoryKeyOnly")}
      </label>
      <p className="text-muted-foreground">{t("ai.memoryKeyHint")}</p>
    </div>
  );
}
