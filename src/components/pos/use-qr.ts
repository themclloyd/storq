import { useEffect, useState } from "react";
import { buildQr, type QrMatrix } from "@/lib/qr";

/**
 * Build a QR matrix for `value`; stale results are dropped when the code edits
 * out from under the dialog. Returns null while the (dynamically imported)
 * encoder is still working or when there is no code yet.
 */
export function useQrMatrix(value: string | null | undefined) {
  const [m, setM] = useState<QrMatrix | null>(null);
  const code = (value ?? "").trim();
  useEffect(() => {
    let alive = true;
    if (!code) {
      setM(null);
      return;
    }
    buildQr(code)
      .then((r) => alive && setM(r))
      .catch(() => alive && setM(null));
    return () => {
      alive = false;
    };
  }, [code]);
  return m;
}
