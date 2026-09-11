import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/dialog.tsx";
import { Button } from "@/components/button.tsx";
import { PasswordInput } from "@/components/password-input.tsx";
import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SudoPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => void | Promise<void>;
}

export function SudoPasswordDialog({
  open,
  onOpenChange,
  onSubmit,
}: SudoPasswordDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<object | null>(null);
  const changeOpen = (next: boolean) => {
    if (!next) {
      pending.current = null;
      setPassword("");
      setLoading(false);
      setError(false);
    }
    onOpenChange(next);
  };
  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      pending.current = null;
      setError(false);
      setPassword("");
      setLoading(false);
    }
  }, [open]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    if (!password || pending.current) {
      return;
    }

    const request = {};
    pending.current = request;
    setLoading(true);
    setError(false);
    try {
      await onSubmit(password);
    } catch {
      if (pending.current === request) setError(true);
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md rounded-none border-border bg-card">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
              <Shield className="size-4 text-accent-brand" />
              {t("fileManager.sudoPasswordRequired")}
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
              {t("fileManager.enterSudoPassword")}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("fileManager.sudoPassword")}
              className="rounded-none bg-muted/50 border-border text-xs focus:ring-1 focus:ring-accent-brand/50"
              autoFocus
              disabled={loading}
            />
          </div>

          {error && <p role="alert">{t("fileManager.sudoOperationFailed")}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => changeOpen(false)}
              className="rounded-none text-[10px] font-bold uppercase tracking-widest"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!password || loading}
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
            >
              {loading ? t("common.loading") : t("common.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
