import { useCallback, useEffect, useRef, useState } from "react";
import { fileDocumentApi, fileDocumentFailure } from "@/api/file-document-api";
import type {
  FileCharset,
  FileDocumentContent,
  FileDocumentFailure,
  FileTextFormat,
} from "@/types/file-document";
export interface FileSaveReview {
  base: FileDocumentContent;
  content: string;
  format: FileTextFormat;
  saveAs?: string;
}
export function useFileDocument(
  sessionId: string,
  path: string,
  ensureConnection: () => Promise<void>,
) {
  const [base, setBase] = useState<FileDocumentContent>();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FileDocumentFailure>();
  const [review, setReview] = useState<FileSaveReview>();
  const [resetKey, setResetKey] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const life = useRef<{
    active: boolean;
    loading: boolean;
    saving: boolean;
    epoch: number;
    uncertainPath?: string;
    base?: FileDocumentContent;
    controller?: AbortController;
  }>({ active: true, loading: false, saving: false, epoch: 0 });
  const ensure = useRef(ensureConnection);
  ensure.current = ensureConnection;
  const release = useCallback(
    (documentId: string) => {
      void fileDocumentApi.close(sessionId, documentId).catch(() => {});
    },
    [sessionId],
  );
  const reload = useCallback(
    async (keepDraft = false, charset?: FileCharset) => {
      const state = life.current;
      if (state.saving || state.loading || !state.active) return;
      const epoch = ++state.epoch;
      state.loading = true;
      state.controller = new AbortController();
      setLoading(true);
      try {
        await ensure.current();
        if (!state.active || epoch !== state.epoch) return;
        const next = await fileDocumentApi.read(
          sessionId,
          state.uncertainPath ?? state.base?.document.path ?? path,
          charset ?? state.base?.document.format?.charset,
          state.controller.signal,
        );
        if (!state.active || epoch !== state.epoch) {
          release(next.document.documentId);
          return;
        }
        const previous = state.base;
        state.uncertainPath = undefined;
        state.base = next;
        setBase(next);
        setError(undefined);
        setReview(undefined);
        if (!keepDraft || !previous) {
          setDraft(next.content);
          setResetKey((k) => k + 1);
        }
        if (
          previous &&
          previous.document.documentId !== next.document.documentId
        )
          release(previous.document.documentId);
      } catch (failure) {
        if (state.active && epoch === state.epoch)
          setError((previous) => ({
            ...fileDocumentFailure(failure),
            latest: previous?.latest,
            commitMayHaveOccurred: previous?.commitMayHaveOccurred ?? false,
          }));
      } finally {
        if (epoch === state.epoch) {
          state.loading = false;
          if (state.active) setLoading(false);
        }
      }
    },
    [sessionId, path, release],
  );
  useEffect(() => {
    const state = life.current;
    state.active = true;
    state.loading = false;
    void reload();
    return () => {
      state.active = false;
      ++state.epoch;
      state.controller?.abort();
      if (state.base) release(state.base.document.documentId);
      state.base = undefined;
    };
  }, [reload, release]);
  const edit = useCallback((value: string) => setDraft(value), []);
  const replaceDraft = (value: string) => {
    setDraft(value.replace(/\r\n|\r/g, "\n"));
    setResetKey((k) => k + 1);
  };
  const requestSave = (content = draft) => {
    if (
      !base?.document.editable ||
      !base.document.format ||
      saving ||
      loading ||
      error?.commitMayHaveOccurred ||
      error?.latest
    )
      return;
    setReview({ base, content, format: { ...base.document.format } });
  };
  const acceptLatest = (keepDraft: boolean) => {
    if (!error?.latest || saving) return;
    const next = error.latest;
    life.current.base = next;
    setBase(next);
    if (!keepDraft) replaceDraft(next.content);
    setError(undefined);
    setReview(undefined);
  };
  const save = async (takeover = false) => {
    const state = life.current;
    if (
      !review ||
      state.saving ||
      state.loading ||
      !state.active ||
      error?.commitMayHaveOccurred ||
      error?.latest
    )
      return false;
    const snapshot = structuredClone(review),
      epoch = state.epoch;
    state.saving = true;
    state.controller = new AbortController();
    setSaving(true);
    setError(undefined);
    try {
      const result = await fileDocumentApi.save(
        {
          sessionId,
          path: snapshot.base.document.path,
          content: snapshot.content,
          version: snapshot.base.document.version,
          requestId: crypto.randomUUID(),
          format: snapshot.format,
          takeover,
          saveAs: snapshot.saveAs || undefined,
        },
        state.controller.signal,
      );
      if (!state.active || epoch !== state.epoch) return false;
      const next: FileDocumentContent = {
        document: result.document,
        content: snapshot.content.replace(/\r\n|\r/g, "\n"),
        path: result.document.path,
        encoding: "utf8",
      };
      state.uncertainPath = undefined;
      state.base = next;
      setBase(next);
      setReview(undefined);
      setSavedCount((n) => n + 1);
      // Acknowledgment advances only the saved baseline. Keystrokes after submission stay in draft.
      return true;
    } catch (failure) {
      if (state.active && epoch === state.epoch) {
        const error = fileDocumentFailure(failure);
        state.uncertainPath = error.commitMayHaveOccurred
          ? snapshot.saveAs || snapshot.base.document.path
          : undefined;
        setError(error);
      }
      return false;
    } finally {
      state.saving = false;
      if (state.active && epoch === state.epoch) setSaving(false);
    }
  };
  return {
    base,
    draft,
    loading,
    saving,
    error,
    review,
    resetKey,
    savedCount,
    dirty: !!base && draft !== base.content,
    edit,
    replaceDraft,
    reload,
    requestSave,
    setReview,
    acceptLatest,
    save,
  };
}
