/**
 * The catalogs are looked up by dot path, and `t()` renders the raw path when a
 * key is missing, so a typo ships as "laybys.cancelTitle" on screen instead of
 * failing a build. These checks read the source for literal `t("…")` calls and
 * fail on any key the English catalog cannot answer, which is the catalog every
 * locale falls back to.
 *
 * Dynamic keys (`t(\`x.${y}\`)`) are skipped by design: they are resolved by
 * construction, and this check has no way to enumerate them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { ny } from "./i18n/ny";

/** Every leaf path in a catalog, e.g. "laybys.cancelTitle". */
function leafKeys(catalog: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (catalog && typeof catalog === "object") {
    for (const [key, value] of Object.entries(catalog as Record<string, unknown>)) {
      leafKeys(value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (typeof catalog === "string" && prefix) {
    out.add(prefix);
  }
  return out;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** `t("a.b")` and the aliased `tInv("a.b")` form used where `t` is a local name. */
const LITERAL_CALL = /\bt(?:Inv)?\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;

function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  for (const file of sourceFiles("src")) {
    // The catalogs define keys; they do not ask for them.
    if (file.replace(/\\/g, "/").includes("src/lib/i18n/")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(LITERAL_CALL)) {
      const key = match[1];
      if (key) used.set(key, file.replace(/\\/g, "/"));
    }
  }
  return used;
}

describe("i18n catalogs", () => {
  it("answers every literal key the app asks for", () => {
    const known = leafKeys(en);
    const missing = [...usedKeys()]
      .filter(([key]) => !known.has(key))
      .map(([key, file]) => `${key} (used in ${file})`);
    expect(missing).toEqual([]);
  });

  it("keeps the Chichewa catalog inside the English key set", () => {
    const known = leafKeys(en);
    expect([...leafKeys(ny)].filter((key) => !known.has(key))).toEqual([]);
  });
});
