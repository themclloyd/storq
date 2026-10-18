import { useCallback, useRef, useState } from "react";

/**
 * Collapse overlapping calls to one and refuse new calls while the current one
 * is still running or within `cooloffMs` of its end. Wraps every downloadPdf /
 * CSV click so a session cannot spam jsPDF builds (local CPU DoS, blob leaks,
 * browser download-throttle tripping) or heavy all-time export queries. Returns
 * the guarded runner plus the running flag so the trigger can disable itself.
 *
 * The cooloff is deliberately short — a legitimate double-tap still gets
 * through once the first finishes, but rapid-fire clicking collapses to one.
 */
export function useOnce<T extends (...args: never[]) => unknown>(
  fn: T,
  cooloffMs = 1_200,
): { run: (...args: Parameters<T>) => Promise<void>; running: boolean } {
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const lastEndRef = useRef(0);
  // Keep the latest closure without re-creating the memoized runner.
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(
    async (...args: Parameters<T>) => {
      if (runningRef.current) return;
      if (Date.now() - lastEndRef.current < cooloffMs) return;
      runningRef.current = true;
      setRunning(true);
      try {
        await fnRef.current(...args);
      } finally {
        lastEndRef.current = Date.now();
        runningRef.current = false;
        setRunning(false);
      }
    },
    [cooloffMs],
  );
  return { run, running };
}
