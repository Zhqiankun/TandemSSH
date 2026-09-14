import { useRef, useCallback, useLayoutEffect } from "react";
import { saveCommandToHistory } from "@/main-axios.ts";

const SENSITIVE_PATTERNS = [
  /\bpassw(or)?d\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bapi.?key\b/i,
  /\bPASS(WORD)?=/i,
  /\bAWS_SECRET/i,
  /\bmysql\b.*-p/i,
  /\bsudo\s+-S\b/,
  /\bhtpasswd\b/i,
  /\bsshpass\b/i,
  /\bcurl\b.*-u\s/i,
  /\bexport\b.*(?:PASSWORD|SECRET|TOKEN|KEY)=/i,
];

interface UseCommandTrackerOptions {
  hostId?: number;
  enabled?: boolean;
  persist?: boolean;
  onHistorySaved?: (command: string) => void;
}

interface CommandTrackerResult {
  trackInput: (data: string) => void;
  bindSession: (sessionId: string) => void;
  getCurrentCommand: () => string;
  clearCurrentCommand: () => void;
  updateCurrentCommand: (command: string) => void;
}

export function useCommandTracker({
  hostId,
  enabled = true,
  persist = true,
  onHistorySaved,
}: UseCommandTrackerOptions): CommandTrackerResult {
  const currentCommandRef = useRef<string>("");
  const boundSessionRef = useRef<string | null>(null);
  const historyScopeRef = useRef(0);
  const isInEscapeSequenceRef = useRef<boolean>(false);

  useLayoutEffect(() => {
    historyScopeRef.current++;
    boundSessionRef.current = null;
    currentCommandRef.current = "";
    isInEscapeSequenceRef.current = false;
    return () => {
      historyScopeRef.current++;
    };
  }, [hostId, enabled, persist]);

  const bindSession = useCallback((sessionId: string) => {
    if (boundSessionRef.current === sessionId) return;
    boundSessionRef.current = sessionId;
    historyScopeRef.current++;
    currentCommandRef.current = "";
    isInEscapeSequenceRef.current = false;
  }, []);

  const trackInput = useCallback(
    (data: string) => {
      if (!enabled || !hostId) {
        return;
      }

      for (const char of data) {
        const charCode = char.codePointAt(0)!;

        if (charCode === 27) {
          isInEscapeSequenceRef.current = true;
          continue;
        }

        if (isInEscapeSequenceRef.current) {
          if (
            (charCode >= 65 && charCode <= 90) ||
            (charCode >= 97 && charCode <= 122) ||
            charCode === 126
          ) {
            isInEscapeSequenceRef.current = false;
          }
          continue;
        }

        if (charCode === 13 || charCode === 10) {
          const command = currentCommandRef.current.trim();

          if (command.length > 0) {
            const isSensitive = SENSITIVE_PATTERNS.some((p) => p.test(command));

            if (!isSensitive && persist) {
              const scope = historyScopeRef.current;
              void saveCommandToHistory(hostId, command)
                .then((saved) => {
                  if (saved.id > 0 && historyScopeRef.current === scope)
                    onHistorySaved?.(command);
                })
                .catch((error) => {
                  console.error("Failed to save command to history:", error);
                });
            }
          }

          currentCommandRef.current = "";
          continue;
        }

        if (charCode === 8 || charCode === 127) {
          if (currentCommandRef.current.length > 0) {
            currentCommandRef.current = Array.from(currentCommandRef.current)
              .slice(0, -1)
              .join("");
          }
          continue;
        }

        if (charCode === 3 || charCode === 4) {
          currentCommandRef.current = "";
          continue;
        }

        if (charCode === 21) {
          currentCommandRef.current = "";
          continue;
        }

        if (charCode >= 32 && !(charCode >= 127 && charCode <= 159)) {
          currentCommandRef.current += char;
        }
      }
    },
    [enabled, hostId, onHistorySaved, persist],
  );

  const getCurrentCommand = useCallback(() => {
    return currentCommandRef.current;
  }, []);

  const clearCurrentCommand = useCallback(() => {
    currentCommandRef.current = "";
  }, []);

  const updateCurrentCommand = useCallback((command: string) => {
    currentCommandRef.current = command;
  }, []);

  return {
    trackInput,
    bindSession,
    getCurrentCommand,
    clearCurrentCommand,
    updateCurrentCommand,
  };
}
