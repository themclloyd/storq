// Per-device rolling budget for heavy CSV/PDF exports. Client-side only —
// SQL remains the real guard, but this stops a compromised manager session
// or a scripted client from pulling another 50 k-row scan every time the
// previous finishes. The cap is generous enough that no legitimate workflow
// hits it (20 exports/hour covers full-store backups, month-end, and audit
// pulls together) and resets silently after an hour.

const KEY = "storq-export-quota-v1";
const WINDOW_MS = 60 * 60_000;
const MAX_PER_WINDOW = 20;

type Bucket = { start: number; count: number };

export function consumeExportQuota(): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let bucket: Bucket | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) bucket = JSON.parse(raw) as Bucket;
  } catch {
    bucket = null;
  }
  if (!bucket || now - bucket.start > WINDOW_MS) bucket = { start: now, count: 0 };
  if (bucket.count >= MAX_PER_WINDOW) {
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - bucket.start) };
  }
  bucket.count += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(bucket));
  } catch {
    /* storage unavailable — quota degrades to per-tab only */
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function resetExportQuota() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
