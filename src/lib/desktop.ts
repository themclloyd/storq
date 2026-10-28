/**
 * The packaged till's bridge to its Tauri shell.
 *
 * Everything here is a no-op on the website: `isDesktop()` is false, so the
 * browser keeps its own popups, downloads and origin. In the installed app the
 * same calls reach the Rust commands in `storqdesktop/src-tauri` (the shell
 * exposes them through the global Tauri bridge, so the web bundle carries no
 * desktop-only dependency).
 *
 * The download URL below is the public location of the Windows installer. It is
 * overwritten on every publish, so the website and the in-app sidebar always hand
 * out the newest build. Real integrity comes from the minisign signature the app
 * verifies on update, not from this URL.
 */
import { SITE_URL } from "@/lib/seo";

const rawSupabaseUrl = (import.meta.env?.["VITE_SUPABASE_URL"] as string | undefined) ?? "";

// Fall back to the live project so a missing build-time variable can never render
const host =
  rawSupabaseUrl.trim().replace(/\/+$/, "") || "https://gtkfczmudhzhbdooftsa.supabase.co";

export const DESKTOP_DOWNLOAD_URL = `${host}/storage/v1/object/public/storq-updates/desktop/StorqPOS-latest.exe`;

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

type TauriWindow = Window & {
  __TAURI__?: { core?: { invoke?: Invoke } };
  __TAURI_INTERNALS__?: { invoke?: Invoke };
};

function bridge(): Invoke | null {
  if (typeof window === "undefined") return null;
  const w = window as TauriWindow;
  const invoke = w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === "function" ? invoke.bind(w.__TAURI__?.core ?? w) : null;
}

/** True only inside the installed Windows app, never in a browser tab. */
export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

/** Call one of the shell's own commands. Throws on the website, by design. */
export async function desktopInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const invoke = bridge();
  if (!invoke) throw new Error("The desktop app is not running.");
  return invoke<T>(command, args);
}

/**
 * The origin of the public website this install belongs to.
 *
 * The packaged app is served from `http://tauri.localhost`, which is useless in
 * an email redirect, a payment callback or a link shared on WhatsApp, so those
 * places ask for the web origin instead.
 */
export const PUBLIC_ORIGIN = SITE_URL || "https://storq.xyz";

/** Absolute URL on the public site, for links that leave the app. */
export function publicAppUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  // A browser tab is already on the site it should come back to, previews and
  // custom domains included; the installed app has no web origin of its own, so
  // it uses the published one.
  const origin = isDesktop() ? PUBLIC_ORIGIN : window.location.origin;
  return `${origin.replace(/\/+$/, "")}${clean}`;
}

/** Open a link in the system browser (window.open would open a webview popup). */
export async function openExternal(url: string): Promise<void> {
  if (!isDesktop()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await desktopInvoke("open_external", { url });
  } catch (e) {
    console.error("could not open link", e);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked so a multi-megabyte PDF cannot blow the argument limit of
  // String.fromCharCode.
  const chunk = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function toBase64(data: Blob | string): Promise<string> {
  if (typeof data === "string") return bytesToBase64(new TextEncoder().encode(data));
  return bytesToBase64(new Uint8Array(await data.arrayBuffer()));
}

/**
 * Save a generated document. A packaged webview has no download shelf, so the
 * desktop build asks for a real "Save as" location; the browser keeps the anchor
 * download it always had.
 */
export async function saveDocument(name: string, data: Blob | string): Promise<boolean> {
  // Callers hand over data URLs (QR images) as well as plain text and Blobs.
  let payload: Blob | string = data;
  if (typeof data === "string" && data.startsWith("data:")) {
    payload = await (await fetch(data)).blob();
  }
  if (!isDesktop()) {
    const blob =
      typeof payload === "string"
        ? new Blob([payload], { type: "text/plain;charset=utf-8" })
        : payload;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  try {
    const saved = await desktopInvoke<string | null>("save_file", {
      name,
      data: await toBase64(payload),
    });
    return saved !== null;
  } catch (e) {
    console.error("could not save document", e);
    return false;
  }
}

/**
 * Print a self-contained document (a thermal receipt) without leaving the app.
 * The browser path opens a sized popup; the desktop path prints a hidden frame
 * so the shell itself is never handed to the print dialog.
 */
export function printHtml(html: string): boolean {
  if (!isDesktop()) {
    const w = window.open("", "_blank", "width=380,height=640");
    if (!w) return false;
    w.document.write(html);
    w.document.close();
    return true;
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // A zero-sized, transparent frame still lays out and prints its own document.
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  // `srcdoc` keeps the document inert until it is attached: no document.write
  // sink, and the markup is the receipt builder's own escaped output.
  frame.srcdoc = html;
  frame.addEventListener("load", () => {
    // Some WebView2 builds need the frame laid out before print() is honoured.
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        // Keep the frame alive while the print dialog owns it.
        setTimeout(() => frame.remove(), 60_000);
      }
    }, 120);
  });
  document.body.appendChild(frame);
  return true;
}

export type AppInfo = {
  name: string;
  version: string;
  identifier: string;
  platform: string;
  dataDir?: string | null;
};

export async function appInfo(): Promise<AppInfo | null> {
  if (!isDesktop()) return null;
  try {
    return await desktopInvoke<AppInfo>("app_info");
  } catch {
    return null;
  }
}

export type UpdateInfo = { version: string; currentVersion: string; notes?: string | null };

/** A newer signed build, if this install is behind and the updater is configured. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isDesktop()) return null;
  try {
    return await desktopInvoke<UpdateInfo | null>("check_update");
  } catch {
    // Offline, or an unsigned local build: nothing to announce.
    return null;
  }
}

/** Download, verify and install the pending update, then relaunch. */
export async function installUpdate(): Promise<void> {
  await desktopInvoke("install_update");
}
