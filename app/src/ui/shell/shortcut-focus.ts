/** Shell navigation yields to form editors, dialogs and active IME composition. */
export function shouldIgnoreShellShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) return true;
  const target = event.composedPath()[0] ?? event.target;
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (!element) return false;
  if (element.closest('[role="dialog"], [role="alertdialog"]')) return true;
  // xterm delegates shell shortcuts from its hidden textarea deliberately.
  if (element.matches("textarea.xterm-helper-textarea")) return false;
  const editor = element.closest(
    'input, textarea, select, [role="textbox"], [contenteditable]',
  );
  if (!editor) return false;
  if (editor.hasAttribute("contenteditable"))
    return editor.getAttribute("contenteditable") !== "false";
  return true;
}
