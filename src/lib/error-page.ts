/**
 * Catastrophic-failure fallback rendered when h3 has already swallowed the SSR
 * error into a generic 500 (see server.ts / start.ts). It must stay fully
 * self-contained — no bundled CSS, fonts or JS can be assumed available — so
 * it re-implements the 404 screen's visual language (NotFound.tsx + the
 * .notf-* rules in styles.css) with inline styles, inline SVG and system font
 * stacks, hardcoding the same design-token values as :root and .dark.
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <style>
      /* Light tokens — identical values to :root in src/styles.css. */
      :root {
        --bg: oklch(0.9749 0.0025 228.77);
        --fg: oklch(0.1776 0 0);
        --muted: oklch(0.5658 0 0);
        --card: oklch(1 0 0);
        --muted-bg: oklch(0.9358 0.0025 228.77);
        --border: oklch(0.8875 0.0103 238.52);
        --primary: oklch(0.6514 0.111 196.31);
        --on-primary: oklch(0.999 0 0);
      }
      /* The standalone page cannot read the app's .dark class, so it follows
         the OS preference with the same values as .dark in styles.css. */
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: oklch(0.19 0.01 210);
          --fg: oklch(0.97 0.005 196);
          --muted: oklch(0.7 0.015 200);
          --card: oklch(0.23 0.012 205);
          --muted-bg: oklch(0.28 0.012 205);
          --border: oklch(0.32 0.012 205);
          --primary: oklch(0.72 0.11 196.31);
          --on-primary: oklch(0.18 0.02 200);
        }
      }

      * { box-sizing: border-box; }
      /* Same fluid base size as the app: 13px on small laptops to 15px wide. */
      html { font-size: clamp(13px, 0.25vw + 10.8px, 15px); }
      body {
        margin: 0;
        min-height: 100vh;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background: var(--bg);
        color: var(--fg);
        font-family: "DM Sans Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }

      /* Dot-grid stage with two soft brand glows, mirroring the 404. */
      .stage { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
      .grid {
        position: absolute;
        inset: 0;
        background-image: radial-gradient(circle, color-mix(in oklch, var(--fg) 14%, transparent) 1px, transparent 1px);
        background-size: 26px 26px;
        -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%);
        mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%);
      }
      .orb {
        position: absolute;
        width: 24rem;
        height: 24rem;
        border-radius: 9999px;
        background: radial-gradient(circle, color-mix(in oklch, var(--primary) 16%, transparent), transparent 65%);
        animation: drift 14s ease-in-out infinite alternate;
      }
      .orb-a { top: -8rem; left: -8rem; }
      .orb-b {
        right: -8rem;
        bottom: -8rem;
        animation-delay: -7s;
        background: radial-gradient(circle, color-mix(in oklch, var(--primary) 10%, transparent), transparent 65%);
      }
      @keyframes drift {
        to { transform: translate(5rem, 3rem) scale(1.15); }
      }

      .card {
        position: relative;
        width: 100%;
        max-width: 26rem;
        text-align: center;
      }

      /* The 404's slow searching ring, stalled around an alert mark — the
         load that never finished. */
      .mark {
        position: relative;
        width: 7.5rem;
        height: 7.5rem;
        margin: 0 auto;
        display: grid;
        place-items: center;
      }
      .mark .ring {
        position: absolute;
        inset: 0;
        border-radius: 9999px;
        border: 0.8rem dashed var(--primary);
        animation: spin 9s linear infinite;
      }
      .mark .alert { width: 2.5rem; height: 2.5rem; color: var(--fg); }

      h1 {
        margin: 1.5rem 0 0;
        font-family: "Fraunces Variable", ui-serif, Georgia, serif;
        font-size: clamp(1.5rem, 2.5vw, 1.75rem);
        font-weight: 500;
        letter-spacing: -0.02em;
      }
      .body {
        margin: 0.5rem auto 0;
        max-width: 22rem;
        color: var(--muted);
        line-height: 1.6;
      }

      /* Echo of the failed path, like the 404's path pill. */
      .path {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        max-width: 100%;
        margin-top: 1.25rem;
        padding: 0.375rem 1rem;
        border: 1px solid var(--border);
        border-radius: 9999px;
        background: var(--card);
        font-size: 0.75rem;
      }
      /* .path sets display, so it would beat the UA [hidden] rule. */
      .path[hidden] { display: none; }
      .path svg { width: 1rem; height: 1rem; border-radius: 0.25rem; flex-shrink: 0; }
      .path code {
        font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
        color: var(--muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Same shape as the app's Button: lg size, default + outline variants. */
      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.75rem;
        margin-top: 2rem;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        height: 2.75rem;
        padding: 0 1.5rem;
        border-radius: 6px;
        border: 1px solid transparent;
        font: inherit;
        font-size: 1rem;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        transition: filter 150ms ease-out, transform 150ms ease-out, background-color 150ms ease-out;
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 30%, transparent);
      }
      .btn.primary { background: var(--primary); color: var(--on-primary); }
      .btn.primary:hover { filter: brightness(0.94); }
      .btn.secondary { background: var(--card); color: var(--fg); border-color: var(--border); }
      .btn.secondary:hover { background: var(--muted-bg); }
      .btn:active { transform: scale(0.98); }

      /* Staggered load-in, same curve as the app's .rise. */
      @keyframes rise {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: none; }
      }
      .rise {
        animation: rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: var(--d, 0ms);
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .rise, .orb, .mark .ring { animation: none; }
      }
    </style>
  </head>
  <body>
    <div class="stage" aria-hidden="true">
      <div class="grid"></div>
      <div class="orb orb-a"></div>
      <div class="orb orb-b"></div>
    </div>

    <main class="card">
      <div class="mark rise" style="--d: 0ms">
        <span class="ring" aria-hidden="true"></span>
        <svg class="alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Loading failed">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      </div>

      <h1 class="rise" style="--d: 120ms">This page didn't load</h1>
      <p class="body rise" style="--d: 200ms">
        Something went wrong on our end. You can try refreshing or head back home.
      </p>

      <p class="path rise" id="path-pill" style="--d: 280ms" hidden>
        <svg viewBox="0 0 3061.42 3061.42" aria-hidden="true">
          <rect fill="#00a4a6" width="3061.42" height="3061.42" rx="697.17" ry="697.17" />
          <path fill="#fff" d="M1798.92,2303.24l-629.22-.44,661.64-1145.99,272.32-25.38c193.4-18.03,326.67,189.6,229.74,357.93l-435.89,756.94c-20.3,35.26-57.9,56.97-98.58,56.95Z" />
          <path fill="#fff" d="M1262.49,758.18l629.22.44-661.64,1145.99-272.32,25.38c-193.4,18.03-326.67-189.6-229.74-357.93l435.89-756.94c20.3-35.26,57.9-56.97,98.58-56.95Z" />
        </svg>
        <code id="path"></code>
      </p>

      <div class="actions rise" style="--d: 360ms">
        <button class="btn primary" type="button" onclick="location.reload()">Try again</button>
        <a class="btn secondary" href="/">Go home</a>
      </div>
    </main>

    <script>
      // Echo the failed path like the 404 screen; the pill stays hidden when
      // there is nothing useful to show (or JS is unavailable).
      (function () {
        var pill = document.getElementById("path-pill");
        var code = document.getElementById("path");
        if (pill && code && location.pathname && location.pathname !== "/") {
          code.textContent = location.pathname;
          pill.hidden = false;
        }
      })();
    </script>
  </body>
</html>`;
}
