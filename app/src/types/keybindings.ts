export const DEFAULT_KEYBINDING_IDS = [
  "default-copy-ctrlc",
  "default-copy-ctrlshiftc",
  "default-copy-cmdc",
  "default-paste-ctrlshiftv",
  "default-ctrlaltw",
  "default-ctrlaltt",
  "default-ctrlaltn",
  "default-ctrlaltq",
] as const;
export type DefaultKeybindingId = (typeof DEFAULT_KEYBINDING_IDS)[number];

export interface KeyCombo {
  key: string;
  isCode: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type KeybindingActionType =
  "copy" | "paste" | "sendControlCode" | "sendText" | "runSnippet";

export interface KeybindingAction {
  type: KeybindingActionType;
  text?: string;
  controlCode?: string;
  snippetId?: string;
  appendEnter?: boolean;
}

export interface CustomKeybinding {
  id: string;
  combo: KeyCombo;
  action: KeybindingAction;
  enabled: boolean;
  needsReview?: boolean;
  overridesDefaultId?: string;
  createdAt: string;
  updatedAt: string;
}
