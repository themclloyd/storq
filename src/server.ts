import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { servePaymentsApi } from "./lib/payments.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// Baseline CSP. TanStack Start inlines hydration scripts and jsPDF uses blob:
// URLs for exports, so 'unsafe-inline' + blob: are required for the app to
// work; frame-ancestors 'none' and object-src 'none' close the click-jacking
// and plugin surfaces. Supabase is the only outbound API and only its public
// host is needed; Inter ships bundled with our stylesheet, so no font origin is
// allowed. Public marketing pages remain independent of this header.
// PayChangu popup.js is loaded on demand for subscription payments; it also
// opens a hosted checkout frame and posts to its API, so script-src, frame-src,
// and connect-src must allow its domain. Cloudflare Turnstile loads its embed
// script and runs the challenge in its own frame, so both script-src and
// frame-src must allow challenges.cloudflare.com, only when a site key (and
// therefore the widget) is actually in use; harmless to allow otherwise.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://in.paychangu.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.paychangu.com",
  "frame-src 'none' https://*.paychangu.com https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "geolocation=(), microphone=(), camera=(self), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "x-dns-prefetch-control": "off",
};

function applySecurityHeaders(response: Response): Response {
  // Response headers are immutable; clone with mutated headers so streaming
  // bodies (SSR HTML) stay intact.
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  // HSTS only makes sense once we're served over https; the edge (Cloudflare /
  // Supabase custom domain) terminates TLS and forwards x-forwarded-proto.
  if (headers.get("x-forwarded-proto") === "https") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"}, try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return host ? `${proto}://${host}` : url.origin;
}

// Serve /robots.txt and /sitemap.xml straight from the request so the absolute
// origin is always correct, whatever domain this build is deployed on.
function serveSeoFiles(request: Request): Response | null {
  const { pathname } = new URL(request.url);
  if (pathname !== "/robots.txt" && pathname !== "/sitemap.xml") return null;
  const origin = requestOrigin(request);
  const isHead = request.method === "HEAD";
  if (pathname === "/robots.txt") {
    const body =
      "User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /auth\n\n" +
      `Sitemap: ${origin}/sitemap.xml\n`;
    return new Response(isHead ? null : body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${origin}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n` +
    "</urlset>\n";
  return new Response(isHead ? null : body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const seoFile = serveSeoFiles(request);
      if (seoFile) return applySecurityHeaders(seoFile);
      // Provider callbacks and the payment sweeper answer before the app router:
      // neither has a session, and both must stay reachable while the shop is
      // locked out of every screen.
      const apiResponse = await servePaymentsApi(request);
      if (apiResponse) return applySecurityHeaders(apiResponse);
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return applySecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return applySecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
