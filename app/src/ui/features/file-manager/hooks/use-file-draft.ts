import { useEffect, useRef, useState } from "react";
import { fileDraftApi, fileDraftError } from "@/api/file-draft-api";
import type { FileDraftSnapshot } from "@/types/file-draft";
import type { FileDocumentContent } from "@/types/file-document";
export function useFileDraft(
  sessionId: string,
  base: FileDocumentContent | undefined,
  content: string,
) {
  const [snapshot, setSnapshot] = useState<FileDraftSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState<string>(),
    [error, setError] = useState<string>(),
    [refresh, setRefresh] = useState(0);
  const version = base?.document.version,
    eligible = !!base?.document.editable,
    key = JSON.stringify([sessionId, version]),
    life = useRef({ active: true, key, pending: false });
  life.current.key = key;
  useEffect(() => {
    const state = life.current;
    state.active = true;
    const stop = new AbortController();
    let live = true;
    setSnapshot(null);
    setLoaded(undefined);
    setError(undefined);
    const logout = () => {
      live = false;
      state.active = false;
      stop.abort();
      setSnapshot(null);
      setLoaded(undefined);
    };
    window.addEventListener("termix:logout", logout);
    if (version && eligible) {
      setBusy(true);
      void fileDraftApi
        .read(sessionId, version, stop.signal)
        .then((value) => {
          if (live) {
            setSnapshot(value);
            setLoaded(key);
          }
        })
        .catch((e) => {
          if (live) setError(fileDraftError(e));
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }
    return () => {
      live = false;
      state.active = false;
      stop.abort();
      window.removeEventListener("termix:logout", logout);
    };
  }, [sessionId, version, eligible, key, refresh]);
  const current = () => life.current.active && life.current.key === key;
  const save = async () => {
    if (
      !base ||
      !eligible ||
      !version ||
      loaded !== key ||
      busy ||
      life.current.pending ||
      !current()
    )
      return false;
    life.current.pending = true;
    setBusy(true);
    setError(undefined);
    try {
      const next = await fileDraftApi.write({
        sessionId,
        version,
        expectedRevision: snapshot?.revision ?? null,
        original: base.content,
        content,
      });
      if (!current()) return false;
      setSnapshot(next);
      return true;
    } catch (e) {
      if (current()) setError(fileDraftError(e));
      return false;
    } finally {
      life.current.pending = false;
      if (current()) setBusy(false);
    }
  };
  const remove = async () => {
    if (!snapshot || !version || busy || life.current.pending || !current())
      return false;
    life.current.pending = true;
    setBusy(true);
    setError(undefined);
    try {
      await fileDraftApi.remove(sessionId, version, snapshot.revision);
      if (!current()) return false;
      setSnapshot(null);
      return true;
    } catch (e) {
      if (current()) setError(fileDraftError(e));
      return false;
    } finally {
      life.current.pending = false;
      if (current()) setBusy(false);
    }
  };
  return {
    snapshot: loaded === key ? snapshot : null,
    busy,
    error,
    canSave: eligible && loaded === key && !busy && life.current.active,
    save,
    remove,
    reload: () => setRefresh((n) => n + 1),
    matches:
      !!snapshot &&
      snapshot.content === content &&
      snapshot.original === base?.content,
  };
}
