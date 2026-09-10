import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
export function OwnershipEditor({
  owner,
  group,
  disabled,
  onSave,
  onBusyChange,
  onSaved,
}: {
  owner?: string;
  group?: string;
  disabled: boolean;
  onSave: (uid: number, gid: number) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [uid, setUid] = useState(owner ?? ""),
    [gid, setGid] = useState(group ?? ""),
    [error, setError] = useState(false);
  const busy = useRef(false);
  const valid = (value: string) =>
    /^(0|[1-9][0-9]*)$/.test(value) && Number(value) <= 4294967294;
  async function save() {
    if (busy.current || disabled || !valid(uid) || !valid(gid)) return;
    busy.current = true;
    onBusyChange(true);
    setError(false);
    try {
      await onSave(Number(uid), Number(gid));
      onSaved();
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      onBusyChange(false);
    }
  }
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 border-t border-border pt-3"
    >
      <legend className="text-xs font-semibold">
        {t("fileManager.ownershipTitle")}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">
          {t("fileManager.ownerUid")}
          <Input
            inputMode="numeric"
            value={uid}
            onChange={(event) => setUid(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          {t("fileManager.groupGid")}
          <Input
            inputMode="numeric"
            value={gid}
            onChange={(event) => setGid(event.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("fileManager.ownershipHint")}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t("fileManager.ownershipFailed")}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !valid(uid) || !valid(gid)}
        onClick={() => void save()}
      >
        {t("fileManager.saveOwnership")}
      </Button>
    </fieldset>
  );
}
