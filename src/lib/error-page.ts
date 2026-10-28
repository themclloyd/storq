/**
 * Catastrophic-failure fallback rendered when h3 has already swallowed the SSR
 * error into a generic 500 (see server.ts / start.ts). It must stay fully
 * self-contained, no bundled CSS, fonts or JS can be assumed available, so
 * it uses inline styles with system font stacks and the same design-token
 * values as :root / .dark in src/styles.css. Deliberately minimal: this page
 * only needs to tell the user the load failed and offer refresh/home.
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
      :root {
        --bg: oklch(0.9749 0.0025 228.77);
        --fg: oklch(0.1776 0 0);
        --muted: oklch(0.5658 0 0);
        --card: oklch(1 0 0);
        --border: oklch(0.8875 0.0103 238.52);
        --primary: oklch(0.6514 0.111 196.31);
        --on-primary: oklch(0.999 0 0);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: oklch(0.19 0.01 210);
          --fg: oklch(0.97 0.005 196);
          --muted: oklch(0.7 0.015 200);
          --card: oklch(0.23 0.012 205);
          --border: oklch(0.32 0.012 205);
          --primary: oklch(0.72 0.11 196.31);
          --on-primary: oklch(0.18 0.02 200);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background: var(--bg);
        color: var(--fg);
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        line-height: 1.5;
      }
      .card { width: 100%; max-width: 26rem; text-align: center; }
      h1 { margin: 0; font-size: 1.5rem; font-weight: 600; }
      p { margin: 0.5rem 0 0; color: var(--muted); }
      .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.75rem; margin-top: 1.75rem; }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 2.75rem;
        padding: 0 1.5rem;
        border-radius: 6px;
        border: 1px solid transparent;
        font: inherit;
        font-size: 1rem;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
      }
      .btn.primary { background: var(--primary); color: var(--on-primary); }
      .btn.secondary { background: var(--card); color: var(--fg); border-color: var(--border); }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="btn primary" type="button" onclick="location.reload()">Try again</button>
        <a class="btn secondary" href="/">Go home</a>
      </div>
    </main>
  </body>
</html>`;
}
