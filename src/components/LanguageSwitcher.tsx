import { useI18n, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ISO 639-1 codes for the two catalogues: `en` English, `ny` Chichewa/Nyanja.
const SHORT: Record<Locale, string> = { en: "EN", ny: "NY" };

/**
 * Segmented language toggle (English / Chichewa). Drives the shared i18n store,
 * which persists the choice in the `storq-locale` cookie and localStorage.
 * Kept deliberately tiny and token-styled so it drops into any header.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  const options: Locale[] = ["en", "ny"];
  return (
    <div
      role="group"
      aria-label="Change language"
      className={cn(
        "inline-flex items-center rounded-full border bg-card p-0.5 text-xs font-semibold",
        className,
      )}
    >
      {options.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLocale(code)}
          aria-pressed={locale === code}
          title={code === "en" ? "English" : "Chichewa (Nyanja)"}
          className={cn(
            "rounded-full px-2.5 py-1 transition-colors",
            locale === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {SHORT[code]}
        </button>
      ))}
    </div>
  );
}
