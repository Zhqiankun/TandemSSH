import { useCallback, useEffect, useRef, useState } from "react";
import { DraggableWindow } from "./DraggableWindow";
import { FileViewer } from "./FileViewer";
import { useWindowManager } from "./WindowManager";
import { downloadSSHFile, getSSHStatus, connectSSH } from "@/main-axios";
import { toast } from "sonner";
import type { SSHHost } from "@/types/index";
import type { FileCharset } from "@/types/file-document";
import { useTranslation } from "react-i18next";
import { useFileDocument } from "../hooks/use-file-document";
import { FileDocumentReview, DocumentFailure } from "./FileDocumentReview";
import { resolveFilePreviewKind } from "../file-preview-preload";
import "./file-document.css";
interface FileItem {
  name: string;
  type: "file" | "directory" | "link";
  path: string;
  size?: number;
  modified?: string;
  permissions?: string;
  owner?: string;
  group?: string;
}
interface FileWindowProps {
  windowId: string;
  file: FileItem;
  sshSessionId: string;
  sshHost: SSHHost;
  initialX?: number;
  initialY?: number;
  onFileNotFound?: (file: FileItem) => void;
}
export function FileWindow({
  windowId,
  file,
  sshSessionId,
  sshHost,
  initialX = 100,
  initialY = 100,
}: FileWindowProps) {
  const { t } = useTranslation();
  const { closeWindow, maximizeWindow, focusWindow, windows } =
    useWindowManager();
  const host = useRef(sshHost);
  host.current = sshHost;
  const ensure = useCallback(async () => {
    const status = await getSSHStatus(sshSessionId);
    if (!status.connected) {
      const h = host.current;
      await connectSSH(sshSessionId, {
        hostId: h.id,
        ip: h.ip,
        port: h.port,
        username: h.username,
        password: h.password,
        sshKey: h.key,
        keyPassword: h.keyPassword,
        authType: h.authType,
        credentialId: h.credentialId,
        userId: h.userId,
      });
    }
  }, [sshSessionId]);
  const doc = useFileDocument(sshSessionId, file.path, ensure);
  const [closeReview, setCloseReview] = useState(false),
    [reloadReview, setReloadReview] = useState(false);
  const [charset, setCharset] = useState<FileCharset>("utf8");
  const [externalEditorPath, setExternalEditorPath] = useState("");
  const [mediaDimensions, setMediaDimensions] = useState<{
    width: number;
    height: number;
  }>();
  const external = useRef<{ editId: string; unsubscribe?: () => void } | null>(
    null,
  );
  const draftRef = useRef(doc.draft);
  draftRef.current = doc.draft;
  const closed = useRef(false);
  const closeExternal = useCallback(async () => {
    const old = external.current;
    external.current = null;
    if (old) {
      old.unsubscribe?.();
      await window.electronAPI
        ?.closeExternalEditor?.(old.editId)
        .catch(() => {});
    }
  }, []);
  useEffect(() => {
    closed.current = false;
    void window.electronAPI
      ?.getSetting?.("fileManager.externalEditorPath")
      .then((value) => {
        if (typeof value === "string" && !closed.current)
          setExternalEditorPath(value);
      })
      .catch(() => {});
    return () => {
      closed.current = true;
      void closeExternal();
    };
  }, [closeExternal]);
  const info = doc.base?.document;
  const currentFile = {
    ...file,
    path: info?.path ?? file.path,
    name: (info?.path ?? file.path).split("/").pop() || file.name,
    size: info?.size ?? file.size,
  };
  const currentWindow = windows.find((w) => w.id === windowId);
  const download = async () => {
    try {
      await ensure();
      const result = await downloadSSHFile(sshSessionId, currentFile.path);
      if (typeof result?.content !== "string") throw Error();
      const bytes = Uint8Array.from(atob(result.content), (c) =>
        c.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: result.mimeType || "application/octet-stream",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName || currentFile.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t("fileDocument.downloadFailed"));
    }
  };
  const openExternal = async () => {
    try {
      await closeExternal();
      const initial = draftRef.current;
      const result = await window.electronAPI?.openExternalEditor({
        fileName: currentFile.name,
        content: initial,
        encoding: "utf8",
        editorPath: externalEditorPath || null,
      });
      if (!result?.success || !result.editId) throw Error();
      if (closed.current) {
        await window.electronAPI?.closeExternalEditor?.(result.editId);
        return;
      }
      let last = initial;
      const unsubscribe = window.electronAPI?.onExternalEditorSaved?.(
        (payload) => {
          if (payload.editId !== result.editId) return;
          // Both editors may change concurrently. Never replace a newer in-app draft silently.
          if (draftRef.current !== last) {
            toast.error(t("fileDocument.externalConflict"));
            return;
          }
          last = payload.content;
          draftRef.current = payload.content;
          doc.replaceDraft(payload.content);
          toast.info(t("fileDocument.externalDraft"));
        },
      );
      external.current = { editId: result.editId, unsubscribe };
    } catch {
      toast.error(t("fileManager.failedToOpenExternalEditor"));
    }
  };
  const chooseExternal = async () => {
    try {
      const r = await window.electronAPI?.showOpenDialog({
        title: t("fileManager.chooseExternalEditor"),
        properties: ["openFile"],
      });
      const p = r?.filePaths?.[0];
      if (!r?.canceled && p) {
        await window.electronAPI?.setSetting?.(
          "fileManager.externalEditorPath",
          p,
        );
        setExternalEditorPath(p);
      }
    } catch {
      toast.error(t("fileManager.failedToSelectExternalEditor"));
    }
  };
  const close = () => {
    void closeExternal();
    closeWindow(windowId);
  };
  const readOnly =
    info &&
    !info.editable &&
    !["image", "audio", "video", "pdf"].includes(
      resolveFilePreviewKind(currentFile.name),
    );
  if (!currentWindow) return null;
  return (
    <DraggableWindow
      title={currentFile.name + (doc.dirty ? " *" : "")}
      initialX={initialX}
      initialY={initialY}
      initialWidth={900}
      initialHeight={660}
      minWidth={400}
      minHeight={300}
      onClose={() => (doc.dirty || doc.saving ? setCloseReview(true) : close())}
      onMaximize={() => maximizeWindow(windowId)}
      onFocus={() => focusWindow(windowId)}
      isMaximized={currentWindow.isMaximized}
      zIndex={currentWindow.zIndex}
      targetSize={mediaDimensions}
    >
      <div className="td-file-document">
        {closeReview ? (
          <section
            className="td-document-close"
            aria-label={t("fileDocument.closeTitle")}
          >
            <h2>{t("fileDocument.closeTitle")}</h2>
            <p>
              {t(
                doc.saving
                  ? "fileDocument.closeSaving"
                  : "fileDocument.closeDirty",
              )}
            </p>
            <button onClick={() => setCloseReview(false)}>
              {t("fileDocument.keepEditing")}
            </button>
            <button onClick={close}>{t("fileDocument.discardClose")}</button>
          </section>
        ) : reloadReview ? (
          <section className="td-document-close">
            <h2>{t("fileDocument.reloadTitle")}</h2>
            <p>{t("fileDocument.reloadHint")}</p>
            <button onClick={() => setReloadReview(false)}>
              {t("fileDocument.keepEditing")}
            </button>
            <button
              onClick={() => {
                setReloadReview(false);
                void doc.reload(false, charset);
              }}
            >
              {t("fileDocument.reloadDiscard")}
            </button>
          </section>
        ) : doc.review ? (
          <FileDocumentReview
            review={doc.review}
            draft={doc.draft}
            error={doc.error}
            saving={doc.saving}
            onChange={doc.setReview}
            onBack={() => doc.setReview(undefined)}
            onSave={(takeover) => {
              void doc.save(takeover).then((ok) => {
                if (ok) toast.success(t("fileManager.fileSavedSuccessfully"));
              });
            }}
            onLatest={doc.acceptLatest}
            onRefresh={() => {
              void doc.reload(true);
            }}
          />
        ) : (
          <>
            <div className="td-document-bar">
              <span>
                {info?.hostIdentity ?? t("fileDocument.connectionPending")}
              </span>
              <span>
                {t(
                  doc.dirty
                    ? "fileDocument.unsaved"
                    : doc.savedCount
                      ? "fileDocument.saved"
                      : "fileDocument.manualSave",
                )}
              </span>
              <label>
                {t("fileDocument.reopenEncoding")}{" "}
                <select
                  aria-label={t("fileDocument.reopenEncoding")}
                  value={charset}
                  disabled={doc.saving || doc.loading}
                  onChange={(e) => setCharset(e.target.value as FileCharset)}
                >
                  {["utf8", "utf16le", "utf16be", "gbk", "gb18030"].map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={doc.saving || doc.loading}
                onClick={() =>
                  doc.dirty
                    ? setReloadReview(true)
                    : void doc.reload(false, charset)
                }
              >
                {t("fileDocument.reopen")}
              </button>
              {doc.error?.commitMayHaveOccurred && (
                <button onClick={() => void doc.reload(true)}>
                  {t("fileDocument.refreshKeepDraft")}
                </button>
              )}
              {doc.error?.latest && (
                <button
                  onClick={() => {
                    if (doc.base?.document.format)
                      doc.setReview({
                        base: doc.base,
                        content: doc.draft,
                        format: doc.base.document.format,
                      });
                  }}
                >
                  {t("fileDocument.resolveConflict")}
                </button>
              )}
            </div>
            {doc.error && <DocumentFailure failure={doc.error} />}
            <div className="td-document-body">
              {readOnly ? (
                <section className="td-document-close">
                  <p>{t("fileDocument.readOnly." + info.readOnlyReason)}</p>
                  <button onClick={() => void download()}>
                    {t("fileManager.download")}
                  </button>
                  {doc.base?.encoding === "utf8" && (
                    <pre className="overflow-auto whitespace-pre-wrap">
                      {doc.base.content.slice(0, 16000)}
                    </pre>
                  )}
                </section>
              ) : (
                <FileViewer
                  file={currentFile}
                  content={doc.draft}
                  savedContent={doc.base?.content ?? ""}
                  isLoading={doc.loading}
                  isSaving={doc.saving}
                  resetKey={doc.resetKey}
                  isEditable={!!info?.editable}
                  onContentChange={doc.edit}
                  onSave={doc.requestSave}
                  onRevert={() => setReloadReview(true)}
                  onDownload={() => void download()}
                  onOpenExternal={
                    window.electronAPI?.isElectron && info?.editable
                      ? () => void openExternal()
                      : undefined
                  }
                  onChooseExternalEditor={
                    window.electronAPI?.isElectron && info?.editable
                      ? () => void chooseExternal()
                      : undefined
                  }
                  onMediaDimensionsChange={setMediaDimensions}
                />
              )}
            </div>
          </>
        )}
      </div>
    </DraggableWindow>
  );
}
