import type { Terminal } from "@xterm/xterm";
import type { KeybindingAction } from "@/types/keybindings";
import {
  hasSnippetInputs,
  resolveSnippetContent,
  type SnippetHostContext,
} from "@/lib/snippet-variables";

export interface KeybindingDispatchContext {
  terminal: Terminal;
  /** Display a safe message; underlying errors may contain sensitive data. */
  onFailure?: () => void;
  /** SSH session may end while its WebSocket remains open. */
  isSessionCurrent?: () => boolean;
  /** Caller-owned clipboard read/confirmation policy. */
  pasteFromClipboard?: () => void;
  webSocketRef: React.MutableRefObject<WebSocket | null>;
  writeTextToClipboard: (text: string) => Promise<boolean>;
  readTextFromClipboard: () => Promise<string>;
  getSnippetById: (id: string) => Promise<{ content: string } | undefined>;
  /** Host context used to silently resolve $HOST/$USER/$PORT/$NAME in runSnippet actions. */
  hostContext?: SnippetHostContext | null;
  /**
   * Called instead of sending the snippet directly when its content still has
   * unresolved $INPUT_n placeholders after host-variable substitution -- the
   * caller is expected to collect values (e.g. via a dialog) and send itself.
   */
  onSnippetNeedsInputs?: (
    snippet: { id: string; content: string },
    sendResolved: (text: string) => boolean,
  ) => void;
}

export function sendRawToSocket(
  webSocketRef: React.MutableRefObject<WebSocket | null>,
  data: string,
): void {
  if (webSocketRef.current?.readyState === 1) {
    webSocketRef.current.send(JSON.stringify({ type: "input", data }));
  }
}

export function dispatchKeybindingAction(
  action: KeybindingAction,
  ctx: KeybindingDispatchContext,
): void {
  const destination = ctx.webSocketRef.current;
  const isCurrentDestination = () =>
    destination !== null &&
    destination.readyState === 1 &&
    ctx.webSocketRef.current === destination &&
    (ctx.isSessionCurrent?.() ?? true);
  const sendRaw = (data: string) => {
    if (isCurrentDestination()) sendRawToSocket(ctx.webSocketRef, data);
  };

  switch (action.type) {
    case "copy": {
      const selection = ctx.terminal.getSelection();
      if (selection) {
        void ctx
          .writeTextToClipboard(selection)
          .then((copied) => {
            if (!copied) {
              ctx.onFailure?.();
              return;
            }
            if (ctx.terminal.getSelection() === selection)
              ctx.terminal.clearSelection();
          })
          .catch(() => ctx.onFailure?.());
      }
      return;
    }
    case "paste": {
      if (ctx.pasteFromClipboard) {
        ctx.pasteFromClipboard();
        return;
      }
      if (!isCurrentDestination()) return;
      void ctx
        .readTextFromClipboard()
        .then((text) => {
          if (text && isCurrentDestination()) ctx.terminal.paste(text);
        })
        .catch(() => {
          if (isCurrentDestination()) ctx.onFailure?.();
        });
      return;
    }
    case "sendControlCode": {
      if (!action.controlCode) return;
      const code = action.controlCode.toLowerCase().charCodeAt(0) - 96;
      if (code >= 1 && code <= 26) sendRaw(String.fromCharCode(code));
      return;
    }
    case "sendText": {
      sendRaw((action.text ?? "") + (action.appendEnter ? "\r" : ""));
      return;
    }
    case "runSnippet": {
      if (!action.snippetId || !isCurrentDestination()) return;
      void ctx
        .getSnippetById(action.snippetId)
        .then((snippet) => {
          if (!snippet || !isCurrentDestination()) return;
          if (hasSnippetInputs(snippet.content)) {
            let consumed = false;
            const sendResolved = (text: string): boolean => {
              if (consumed) return false;
              consumed = true;
              if (!isCurrentDestination()) return false;
              sendRaw(text);
              return true;
            };
            ctx.onSnippetNeedsInputs?.(
              {
                id: action.snippetId!,
                content: snippet.content,
              },
              sendResolved,
            );
            return;
          }
          const resolved = resolveSnippetContent(
            snippet.content,
            ctx.hostContext ?? null,
            {},
          );
          sendRaw(resolved + (action.appendEnter !== false ? "\r" : ""));
        })
        .catch(() => {
          if (isCurrentDestination()) ctx.onFailure?.();
        });
      return;
    }
  }
}
