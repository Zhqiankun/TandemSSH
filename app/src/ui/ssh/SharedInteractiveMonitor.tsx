import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { KeyboardInteractiveDialog } from "./dialogs/KeyboardInteractiveDialog";
import { sharedInteractiveApi } from "@/api/shared-interactive-api";
import {
  isInteractiveChallenge,
  type SharedSSHInteractiveRequest,
} from "@/types/ssh-interactive-auth";
export function SharedInteractiveMonitor({
  userId,
}: {
  userId: string | null;
}) {
  const { t } = useTranslation();
  const [requestOwner, setRequestOwner] = useState(userId);
  const [requests, setRequests] = useState<SharedSSHInteractiveRequest[]>([]),
    [waiting, setWaiting] = useState(false),
    [error, setError] = useState<string>();
  const life = useRef<AbortController | null>(null),
    revision = useRef(0),
    acting = useRef(false),
    cancelling = useRef(false),
    refresh = useRef<() => void>(() => {});
  useEffect(() => {
    const stop = new AbortController();
    life.current = stop;
    setRequestOwner(userId);
    revision.current++;
    acting.current = false;
    cancelling.current = false;
    setRequests([]);
    setWaiting(false);
    setError(undefined);
    if (!userId) return () => stop.abort();
    let polling = false;
    const poll = async () => {
      if (polling || acting.current || stop.signal.aborted) return;
      polling = true;
      const current = revision.current;
      try {
        const value = await sharedInteractiveApi.pending(stop.signal);
        if (stop.signal.aborted || current !== revision.current) return;
        setRequests(
          value.requests.filter(
            (r) =>
              isInteractiveChallenge(r) &&
              r.target &&
              ["files", "monitoring", "jump"].includes(r.target.channel) &&
              typeof r.target.address === "string",
          ),
        );
      } catch {
        if (!stop.signal.aborted && current === revision.current)
          setRequests([]);
      } finally {
        polling = false;
      }
    };
    refresh.current = () => {
      void poll();
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      stop.abort();
      clearInterval(timer);
    };
  }, [userId]);
  const request = requests[0];
  useEffect(() => {
    setWaiting(false);
    setError(undefined);
  }, [request?.id]);
  if (!request || requestOwner !== userId || !userId) return null;
  const act = async (responses?: string[]) => {
    const signal = life.current?.signal;
    const cancel = responses === undefined;
    if (
      !signal ||
      signal.aborted ||
      cancelling.current ||
      (!cancel && (acting.current || waiting || request.waiting))
    )
      return;
    if (cancel) cancelling.current = true;
    const operation = ++revision.current;
    acting.current = true;
    setWaiting(true);
    setError(undefined);
    try {
      if (responses === undefined)
        await sharedInteractiveApi.cancel(request.id, signal);
      else await sharedInteractiveApi.respond(request.id, responses, signal);
      if (signal.aborted || operation !== revision.current) return;
      setRequests((old) =>
        cancel
          ? old.filter((r) => r.id !== request.id)
          : old.map((r) => (r.id === request.id ? { ...r, waiting: true } : r)),
      );
    } catch (e) {
      if (!signal.aborted && operation === revision.current)
        setError(
          (e as { response?: { data?: { error?: string } } }).response?.data
            ?.error ?? "SSH_AUTH_CONNECTION_LOST",
        );
    } finally {
      if (!signal.aborted && operation === revision.current) {
        acting.current = false;
        cancelling.current = false;
        revision.current++;
        setWaiting(false);
        refresh.current();
      }
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[700]">
      <KeyboardInteractiveDialog
        key={request.id}
        challenge={request}
        hostLabel={
          t("sshInteractive.channels." + request.target.channel) +
          " · " +
          (request.target.hostname ?? request.target.address) +
          " · " +
          request.target.username +
          "@" +
          request.target.address +
          ":" +
          request.target.port
        }
        waiting={waiting || request.waiting === true}
        error={error}
        onSubmit={(answers) => void act(answers)}
        onCancel={() => void act()}
      />
    </div>,
    document.body,
  );
}
