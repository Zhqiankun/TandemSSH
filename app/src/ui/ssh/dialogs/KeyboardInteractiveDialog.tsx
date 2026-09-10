import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  validInteractiveResponses,
  SSH_AUTH_MAX_RESPONSE_BYTES,
  type SSHInteractiveChallenge,
} from "@/types/ssh-interactive-auth";
export function KeyboardInteractiveDialog({
  challenge,
  hostLabel,
  waiting,
  error,
  onSubmit,
  onCancel,
  backgroundColor,
}: {
  challenge: SSHInteractiveChallenge;
  hostLabel: string;
  waiting: boolean;
  error?: string;
  onSubmit: (responses: string[]) => void;
  onCancel: () => void;
  backgroundColor?: string;
}) {
  const { t } = useTranslation(),
    id = useId();
  const [responses, setResponses] = useState(() =>
    challenge.prompts.map(() => ""),
  );
  const [expired, setExpired] = useState(false),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, Math.min(300000, challenge.expiresAt - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [challenge.expiresAt]);
  const message =
    expired && !waiting
      ? "SSH_AUTH_TIMEOUT"
      : invalid
        ? "SSH_AUTH_INVALID_RESPONSE"
        : error;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={id + "-title"}
      className="absolute inset-0 z-500 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-canvas" style={{ backgroundColor }} />
      <section className="relative z-10 flex max-h-[90%] w-full max-w-lg flex-col border border-border bg-card shadow-xl">
        <header className="border-b border-border p-4">
          <h3
            id={id + "-title"}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Shield className="size-4 text-accent-brand" />
            {t("sshInteractive.title")}
          </h3>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {hostLabel}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("sshInteractive.serverPrompt")}
          </p>
          {challenge.name && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {challenge.name}
            </p>
          )}
          {challenge.instructions && (
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {challenge.instructions}
            </p>
          )}
        </header>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (waiting || expired) return;
            if (
              !validInteractiveResponses(responses, challenge.prompts.length)
            ) {
              setInvalid(true);
              return;
            }
            const answer = [...responses];
            setResponses(challenge.prompts.map(() => ""));
            setInvalid(false);
            onSubmit(answer);
          }}
        >
          <div className="min-h-0 space-y-4 overflow-y-auto p-4">
            {message && (
              <p role="alert" className="text-xs text-destructive">
                {t("sshInteractive.errors." + message, {
                  defaultValue: t("sshInteractive.failed"),
                })}
              </p>
            )}
            {waiting ? (
              <p
                role="status"
                className="flex items-center gap-2 py-4 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
                {t("sshInteractive.waiting")}
              </p>
            ) : (
              challenge.prompts.map((prompt, index) => (
                <div key={prompt.index} className="space-y-1.5">
                  <label
                    htmlFor={id + "-" + index}
                    className="block whitespace-pre-wrap break-words text-xs font-medium"
                  >
                    {prompt.prompt ||
                      t("sshInteractive.response", { number: index + 1 })}
                  </label>
                  <Input
                    id={id + "-" + index}
                    name={"ssh-auth-" + index}
                    type={prompt.echo ? "text" : "password"}
                    autoFocus={index === 0}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={SSH_AUTH_MAX_RESPONSE_BYTES}
                    disabled={expired}
                    value={responses[index]}
                    onChange={(event) => {
                      const value = event.target.value;
                      setInvalid(false);
                      setResponses((previous) =>
                        previous.map((old, at) => (at === index ? value : old)),
                      );
                    }}
                  />
                </div>
              ))
            )}
            {!waiting && (
              <p className="text-xs text-muted-foreground">
                {t("sshInteractive.emptyAllowed")}
              </p>
            )}
          </div>
          <footer className="flex justify-end gap-2 border-t border-border p-3">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={waiting || expired}
            >
              {t("sshInteractive.submit")}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
