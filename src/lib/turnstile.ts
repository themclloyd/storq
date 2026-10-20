// Cloudflare Turnstile is the CAPTCHA layer for the credential endpoints
// (sign-in, sign-up, password reset). The site key is a public identifier that
// ships in the browser bundle; the matching SECRET lives ONLY in Supabase Auth
// settings, where the hosted GoTrue server redeems each token.
//
// CAPTCHA is now ENABLED server-side, so Supabase rejects any credential call
// without a token. The widget must therefore always be able to render: the
// deployed site key is baked here as a guaranteed fallback, and VITE_TURNSTILE_SITE_KEY
// only overrides it (e.g. to rotate to a different widget). A missing env var
// can no longer leave the till unable to sign in.
export const TURNSTILE_SITE_KEY = (
  (import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined)?.trim() ||
  "0x4AAAAAAFeExSOaURtlU5sc"
).trim();

export const turnstileEnabled = (): boolean => TURNSTILE_SITE_KEY !== "";
