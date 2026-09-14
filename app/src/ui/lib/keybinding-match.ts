import type { CustomKeybinding, KeyCombo } from "@/types/keybindings";

/** Composition keys belong to the IME, not application shortcut dispatch. */
export function isImeCompositionKey(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function eventMatchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  if (isImeCompositionKey(e)) return false;
  if (e.ctrlKey !== combo.ctrl) return false;
  if (e.altKey !== combo.alt) return false;
  if (e.shiftKey !== combo.shift) return false;
  if (e.metaKey !== combo.meta) return false;
  const actual = combo.isCode ? e.code : e.key.toLowerCase();
  return actual === combo.key;
}

export function findMatchingKeybinding(
  e: KeyboardEvent,
  bindings: CustomKeybinding[],
): CustomKeybinding | undefined {
  return bindings.find(
    (kb) => kb.enabled && !kb.needsReview && eventMatchesCombo(e, kb.combo),
  );
}
