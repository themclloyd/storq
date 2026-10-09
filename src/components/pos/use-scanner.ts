import { useEffect, useRef } from "react";

/** A keystroke at least this many ms after the previous one reads as human typing. */
const SCANNER_MAX_GAP_MS = 40;
/** A burst slower than the scanner signature still counts once it is this long. */
const SCANNER_MIN_LENGTH = 6;

const isTextTarget = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

/** True where the platform can scan barcodes through the device camera. */
export function cameraScanSupported() {
  return (
    typeof window !== "undefined" &&
    "BarcodeDetector" in window &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/**
 * Hardware barcode scanners act as "keyboard wedges": they emit the full code
 * as a rapid keystroke burst ending in Enter or Tab. This listener buffers
 * printable single-character keys, and when the burst is fast enough (or long
 * enough to be unambiguous) hands the code to `onMatch` instead of the page.
 * Typing into a focused field is never trapped.
 */
export function useScannerWedge(
  onMatch: (code: string) => boolean | void,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const cb = useRef(onMatch);
  cb.current = onMatch;
  const state = useRef({ buf: "", last: 0, fast: false });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const h = (e: KeyboardEvent) => {
      const s = state.current;
      // Reset the chain whenever typing starts in a field, so a search box
      // keeps its text and the wedge only sees true scanner output.
      if (isTextTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) {
        s.buf = "";
        s.fast = false;
        return;
      }
      const now = performance.now();
      const gap = now - s.last;
      s.last = now;
      if (e.key === "Enter" || e.key === "Tab") {
        const code = s.buf;
        s.buf = "";
        s.fast = false;
        if (
          code.length >= 3 &&
          (gap < SCANNER_MAX_GAP_MS * 3 || code.length >= SCANNER_MIN_LENGTH)
        ) {
          if (cb.current(code)) {
            e.preventDefault();
            return;
          }
        }
        return;
      }
      if (e.key.length !== 1) return;
      s.fast = s.buf !== "" && gap < SCANNER_MAX_GAP_MS;
      // A field-less Enter after a long-enough exact code also resolves, so
      // scanners configured without a trailing keystroke still work.
      if (s.fast || s.buf.length < SCANNER_MIN_LENGTH) s.buf += e.key;
      else s.buf = e.key;
      if (s.fast && s.buf.length >= 3 && cb.current(s.buf)) {
        s.buf = "";
        s.fast = false;
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [enabled]);
}
