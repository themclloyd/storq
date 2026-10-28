// Shared, client-safe SEO helpers.
//
// Absolute URLs (canonical, og:url, og:image, sitemap links) come from the
// `VITE_SITE_URL` env var. When it is unset we fall back to relative paths,
// which are always correct and let Google resolve them against the live
// document URL, so a misconfigured or unknown deployment domain can never
// leak a wrong absolute URL into the page.

export const SITE_NAME = "Storq";

const rawBase = ((import.meta.env?.["VITE_SITE_URL"] as string | undefined) ?? "").trim();

/** Absolute site origin without a trailing slash, or "" when not configured. */
export const SITE_URL = rawBase.replace(/\/+$/, "");

/** Turn a path (or already-absolute URL) into an absolute URL when the site origin is known. */
export function absUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return SITE_URL ? `${SITE_URL}${path}` : path;
}

export const PUBLIC_ROBOTS = "index, follow";

/** Default social-share image (absolute once `VITE_SITE_URL` is set). */
export const DEFAULT_OG_IMAGE = absUrl("/og.jpg");

type HeadMeta = Record<string, string>;
type HeadLink = Record<string, string>;

export type SeoInput = {
  title: string;
  description: string;
  /** Route path used for the canonical / og:url (e.g. "/" or "/c/summer-sale"). */
  path: string;
  /** Absolute or root-relative share image. Defaults to /og.jpg. */
  image?: string;
  type?: "website" | "article";
  robots?: string;
  /** Optional `twitter:site` / `twitter:creator` handle (with leading @). */
  twitterSite?: string;
};

/** Full, indexable page metadata: title, description, canonical and social tags. */
export function buildSeo({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  type = "website",
  robots = PUBLIC_ROBOTS,
  twitterSite,
}: SeoInput): { meta: HeadMeta[]; links: HeadLink[] } {
  const canonical = absUrl(path);
  const ogImage = absUrl(image);
  const meta: HeadMeta[] = [
    { title },
    { name: "description", content: description },
    { name: "robots", content: robots },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: type },
    { property: "og:url", content: canonical },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:image", content: ogImage },
    { property: "og:image:alt", content: title },
    { property: "og:locale", content: "en_US" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
  if (twitterSite) meta.push({ name: "twitter:site", content: twitterSite });
  return { meta, links: [{ rel: "canonical", href: canonical }] };
}
