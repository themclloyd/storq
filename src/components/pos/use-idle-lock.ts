import { useEffect, useRef } from "react";

/**
 * Fire `onIdle` once `minutes` of no pointer/key activity have elapsed. Any
 * interaction (or a still-running `paused` flag such as an offline replay)
 * re-arms the countdown. Returns nothing; the effect is fully self-cleaning so
 * it never leaks a timer across dependency changes.
 */
export function useIdleLock(
  onIdle: () => void,
  opts: { enabled: boolean; minutes: number; paused?: boolean },
) {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  const pausedRef = useRef(opts.paused);
  pausedRef.current = opts.paused;

  const { enabled, minutes } = opts;
  useEffect(() => {
    if (!enabled || minutes <= 0 || typeof window === "undefined") return;
    const ms = minutes * 60_000;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Never drop the till mid-replay of queued offline sales.
        if (pausedRef.current) arm();
        else cb.current();
      }, ms);
    };
    const events = ["keydown", "click", "touchstart", "mousemove"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [enabled, minutes]);
}
