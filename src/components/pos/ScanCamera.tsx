import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Camera01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { cameraScanSupported } from "@/components/pos/use-scanner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Minimal typing for the browser BarcodeDetector API (not in lib.dom yet). */
type DetectedBarcode = { rawValue: string; format: string };
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/** Header button that opens the camera scanner; hidden where unsupported. */
export function ScanCameraButton({ onOpen }: { onOpen: () => void }) {
  if (!cameraScanSupported()) return null;
  return (
    <Button
      size="icon"
      variant="outline"
      aria-label="Scan barcode with camera"
      title="Scan with camera"
      onClick={onOpen}
    >
      <HugeiconsIcon icon={Camera01Icon} />
    </Button>
  );
}

// Formats worth trying first; an empty list lets the detector use its defaults.
const WATCHED_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
  "qr_code",
];

/**
 * Camera barcode scanner modal: frames from the rear camera are fed to
 * BarcodeDetector until a retail code is recognised, then `onDetected` decides
 * whether it matches a catalog item. The media stream is always stopped on
 * close, and permission/no-camera failures surface as a readable message.
 */
export function ScanCamera({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => boolean | void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState("");
  const handled = useRef(false);
  // Keep the latest callbacks without restarting the camera on every render.
  const detectedRef = useRef(onDetected);
  detectedRef.current = onDetected;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector as BarcodeDetectorCtor | undefined;
    if (!Ctor) {
      setError("This browser cannot scan barcodes.");
      return;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    let detector: BarcodeDetectorLike | null = null;
    try {
      detector = new Ctor({ formats: WATCHED_FORMATS });
    } catch {
      // Some builds reject a formats list — retry with platform defaults.
      detector = new Ctor();
    }
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } } })
      .then((s) => {
        if (!alive) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = videoRef.current;
        if (v) {
          v.srcObject = s;
          void v.play().catch(() => undefined);
        }
      })
      .catch(() => {
        if (alive) setError("Camera access was blocked — allow it, or use a scanner gun.");
      });

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!detector || !v || v.readyState < 2 || handled.current) return;
      detector
        .detect(v)
        .then((codes) => {
          const hit = codes.find((c) => c.rawValue);
          if (!hit || handled.current) return;
          handled.current = true;
          setLastCode(hit.rawValue);
          if (!detectedRef.current(hit.rawValue)) {
            // Unmatched code: keep the modal open and let the cashier retry.
            handled.current = false;
            setError(`No item matches ${hit.rawValue}`);
          } else {
            closeRef.current();
          }
        })
        .catch(() => undefined);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm gap-0 overflow-hidden p-0 shadow-[var(--shadow-pop)] sm:max-w-sm">
        <DialogHeader className="space-y-0 border-b px-5 py-4 text-left">
          <DialogTitle>Scan barcode</DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            Hold the code in front of the camera.
            {lastCode ? ` Last seen: ${lastCode}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="relative aspect-[4/3] bg-black">
          <video
            ref={videoRef}
            className="size-full object-contain"
            muted
            playsInline
            aria-label="Camera preview"
          />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-accent/80" />
        </div>
        {error && (
          <p role="alert" className="border-t bg-destructive/10 px-5 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="border-t px-5 py-4">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Close camera
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
