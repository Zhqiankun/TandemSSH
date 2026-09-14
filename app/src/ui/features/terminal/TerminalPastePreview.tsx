import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/dialog";
import { Button } from "@/components/button";
export function TerminalPastePreview({
  text,
  target,
  stale,
  onCancel,
  onConfirm,
}: {
  text: string | null;
  target: string;
  stale: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={text !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("terminal.pastePreviewTitle")}</DialogTitle>
          <DialogDescription>
            {t("terminal.pastePreviewHint", { target })}
          </DialogDescription>
        </DialogHeader>
        <textarea
          aria-label={t("terminal.pastePreviewTitle")}
          readOnly
          value={text ?? ""}
          rows={12}
          className="w-full max-h-[50vh] overflow-auto rounded border p-3 font-mono text-sm"
        />
        {stale && <p role="alert">{t("terminal.pasteConnectionChanged")}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button disabled={stale} onClick={onConfirm}>
            {t("terminal.confirmPaste")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
