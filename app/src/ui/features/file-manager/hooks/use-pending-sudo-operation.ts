import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingSudoOperation } from "../file-manager-types";
/** The pending confirmation owns the right to continue after async password
 * validation. Clearing/replacing it revokes that right synchronously. */
export function usePendingSudoOperation() {
  const [pending, setState] = useState<PendingSudoOperation | null>(null);
  const current = useRef<PendingSudoOperation | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      current.current = null;
    };
  }, []);
  const setPending = useCallback((operation: PendingSudoOperation | null) => {
    if (!alive.current) return;
    current.current = operation;
    setState(operation);
  }, []);
  const isCurrent = useCallback(
    (operation: PendingSudoOperation) =>
      alive.current && current.current === operation,
    [],
  );
  return { pending, setPending, isCurrent };
}
