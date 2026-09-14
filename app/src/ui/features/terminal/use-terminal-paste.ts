import { useCallback, useEffect, useRef, useState } from "react";
export interface TerminalPasteTarget {
  identity: object;
  sessionId: string | null;
  label: string;
  paste: (text: string) => void;
}
export function useTerminalPaste(getTarget: () => TerminalPasteTarget | null) {
  const current = useRef(getTarget);
  current.current = getTarget;
  const staged = useRef<{
    text: string;
    label: string;
    target: TerminalPasteTarget;
  } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      staged.current = null;
    };
  }, []);
  const [pending, setPending] = useState<{
    text: string;
    label: string;
    target: TerminalPasteTarget;
  } | null>(null);
  const [stale, setStale] = useState(false);
  const matches = (a: TerminalPasteTarget, b: TerminalPasteTarget | null) =>
    !!b && a.identity === b.identity && a.sessionId === b.sessionId;
  const deliver = useCallback((text: string, target: TerminalPasteTarget) => {
    if (!alive.current || !text || !matches(target, current.current())) return;
    if (/[\r\n]/.test(text)) {
      staged.current = { text, label: target.label, target };
      setPending(staged.current);
      setStale(false);
    } else target.paste(text);
  }, []);
  const request = useCallback(
    (text: string) => {
      const target = current.current();
      if (target) deliver(text, target);
    },
    [deliver],
  );
  const read = useCallback(
    async (reader: () => Promise<string>) => {
      const target = current.current();
      if (!target) return;
      const text = await reader();
      deliver(text, target);
    },
    [deliver],
  );
  const cancel = useCallback(() => {
    staged.current = null;
    setPending(null);
    setStale(false);
  }, []);
  const confirm = useCallback(() => {
    const value = staged.current;
    if (!value || stale) return;
    const target = current.current();
    if (!matches(value.target, target)) {
      setStale(true);
      return;
    }
    staged.current = null;
    setPending(null);
    target!.paste(value.text);
  }, [stale]);
  return { pending, stale, request, read, cancel, confirm };
}
