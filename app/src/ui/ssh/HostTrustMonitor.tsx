import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { Button } from "@/components/button";
import { hostTrustApi, hostTrustError } from "@/api/host-trust-api";
import { copyToClipboard } from "@/lib/clipboard";
import type { HostTrustRequest } from "@/types/host-trust";
export function HostTrustPrompt({
  request,
  pending,
  error,
  count,
  onDecision,
}: {
  request: HostTrustRequest;
  pending: boolean;
  error?: string;
  count: number;
  onDecision: (action: "trust" | "reject", verified: boolean) => void;
}) {
  const { t } = useTranslation(),
    [verified, setVerified] = useState(false),
    [seconds, setSeconds] = useState(
      Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)),
    );
  useEffect(() => {
    const timer = setInterval(
      () =>
        setSeconds(
          Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)),
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [request.expiresAt]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onDecision("reject", false);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("tandem.hostTrust.titles." + request.scenario)}
          </DialogTitle>
          <DialogDescription>
            {t("tandem.hostTrust.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="font-medium select-text break-all">
            {request.hostname ?? request.address}
          </p>
          <p className="font-mono select-text break-all">
            {request.address.includes(":")
              ? "[" + request.address + "]"
              : request.address}
            :{request.port}
          </p>
          <p>
            {t(
              request.isJumpHost
                ? "tandem.hostTrust.jump"
                : "tandem.hostTrust.server",
            )}{" "}
            ·{" "}
            {request.hostId
              ? t("tandem.hostTrust.saved")
              : t("tandem.hostTrust.quick")}
          </p>
          {request.connectionStopped && (
            <p role="alert" className="text-amber-500">
              {t("tandem.hostTrust.stopped")}
            </p>
          )}
          {request.scenario === "legacy" && (
            <p>{t("tandem.hostTrust.legacyHint")}</p>
          )}
          {request.oldFingerprint && (
            <div>
              <p className="text-muted-foreground">
                {t("tandem.hostTrust.old")}
              </p>
              <code className="block select-text break-all">
                {request.oldFingerprint}
              </code>
            </div>
          )}
          <div className="rounded border border-border p-3">
            <p>{request.keyType} · SHA-256</p>
            <code className="block select-text break-all py-2">
              {request.fingerprint}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyToClipboard(request.fingerprint)}
            >
              {t("tandem.hostTrust.copy")}
            </Button>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={verified}
              disabled={pending || seconds === 0}
              onChange={(e) => setVerified(e.target.checked)}
            />
            <span>{t("tandem.hostTrust.verified")}</span>
          </label>
          <p className="text-xs text-muted-foreground">
            {t("tandem.hostTrust.expiry", { seconds, count })}
          </p>
          {error && (
            <p role="alert" className="text-destructive">
              {t("tandem.hostTrust.errors." + error, {
                defaultValue: t("tandem.hostTrust.failed"),
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onDecision("reject", false)}
          >
            {t("tandem.hostTrust.reject")}
          </Button>
          <Button
            disabled={pending || !verified || seconds === 0}
            onClick={() => onDecision("trust", verified)}
          >
            {t(
              pending
                ? "tandem.hostTrust.saving"
                : request.connectionStopped
                  ? "tandem.hostTrust.update"
                  : "tandem.hostTrust.accept",
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function HostTrustMonitor({ userId }: { userId: string | null }) {
  const { t } = useTranslation(),
    [requests, setRequests] = useState<HostTrustRequest[]>([]),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  const lifetime = useRef<AbortController | undefined>(undefined),
    faults = useRef(new Set<string>());
  useEffect(() => {
    setRequests([]);
    setError(undefined);
    setPending(false);
    faults.current.clear();
    if (!userId) return;
    const stop = new AbortController();
    lifetime.current = stop;
    let polling = false;
    const poll = async () => {
      if (polling || stop.signal.aborted) return;
      polling = true;
      try {
        const value = await hostTrustApi.pending(stop.signal);
        if (stop.signal.aborted) return;
        setRequests(value.requests);
        for (const f of value.errors) {
          if (faults.current.has(f.id)) continue;
          faults.current.add(f.id);
          toast.error(
            t("tandem.hostTrust.errors." + f.code, {
              defaultValue: t("tandem.hostTrust.failed"),
            }) +
              " · " +
              f.address +
              ":" +
              f.port,
          );
        }
        const live = new Set(value.errors.map((f) => f.id));
        for (const id of faults.current)
          if (!live.has(id)) faults.current.delete(id);
      } catch {
        /* The connection view also reports a failed backend; never invent approval. */
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    const wake = () => void poll();
    window.addEventListener("host-trust-request", wake);
    return () => {
      stop.abort();
      clearInterval(timer);
      window.removeEventListener("host-trust-request", wake);
    };
  }, [userId, t]);
  const request = requests[0];
  if (!request) return null;
  const decide = async (action: "trust" | "reject", verified: boolean) => {
    const signal = lifetime.current?.signal;
    if (pending || !signal || signal.aborted) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await hostTrustApi.decide(
        {
          requestId: request.id,
          fingerprint: request.fingerprint,
          expectedRevision: request.expectedRevision,
          action,
          verified,
        },
        signal,
      );
      if (signal.aborted) return;
      setRequests((rows) => rows.filter((row) => row.id !== request.id));
      if (result.reconnectRequired) toast.info(t("tandem.hostTrust.reconnect"));
    } catch (e) {
      if (!signal.aborted) setError(hostTrustError(e));
    } finally {
      if (!signal.aborted) setPending(false);
    }
  };
  return (
    <HostTrustPrompt
      key={request.id}
      request={request}
      pending={pending}
      error={error}
      count={requests.length}
      onDecision={(action, verified) => void decide(action, verified)}
    />
  );
}
