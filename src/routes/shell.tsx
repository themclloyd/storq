/**
 * The file the installed app boots from.
 *
 * A packaged till is a folder of static files, so exactly one page has to be
 * prerendered for the webview to open. Prerendering the landing page would flash
 * the marketing site in the window before the router settles on the workspace,
 * so the desktop build masks its shell to this route (`vite.config.desktop.ts`)
 * and this route renders nothing at all.
 *
 * On the website it is a dead end: nothing links here, it asks not to be indexed,
 * and a visitor who arrives anyway is sent home.
 */
import { useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { isDesktop } from "@/lib/desktop";

export const Route = createFileRoute("/shell")({
  head: () => ({
    meta: [
      { title: "Storq POS" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Storq POS." },
    ],
  }),
  component: Shell,
});

function Shell() {
  const router = useRouter();
  useEffect(() => {
    // Never reached in the installed app: its window has no address to point
    // here. On the web this is a blank page, so it goes back to the landing.
    if (!isDesktop()) void router.navigate({ to: "/", replace: true });
  }, [router]);
  return null;
}
