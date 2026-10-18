/**
 * Locale-aware formatting for dates, numbers, and on-chain balances (XLM/USDC).
 *
 * Why this exists: several views formatted values with a hardcoded `"es-MX"`
 * locale or `Number.toFixed(...)`, so dates and numbers looked the same
 * regardless of the language the user picked. These helpers format at render
 * time only — they never mutate the underlying value, so amounts stay exact
 * and accurate; only their presentation changes with the active language.
 *
 * The app's language codes ("es", "en") are valid BCP-47 subtags, so they are
 * handed straight to the Intl APIs. `resolveLocale` guards against an
 * unexpected code by falling back to the default language. To pin a specific
 * region later (e.g. "es-MX"), change the mapping in one place here.
 */

import { useMemo } from "react";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@/i18n/config";
import { useLanguage } from "@/i18n/useLanguage";

/** Map an app language code to the BCP-47 locale used by the Intl APIs. */
export function resolveLocale(language: string): string {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language)
    ? language
    : DEFAULT_LANGUAGE;
}

/**
 * Format a numeric amount (XLM balance, USDC volume, score, …) for display.
 * The value is coerced but never rounded in storage; a non-finite value (e.g.
 * a not-yet-loaded string) is returned unchanged so the UI never shows "NaN".
 *
 * Defaults to 0–2 fraction digits. Pass explicit digits to match a specific
 * column (e.g. `{ minimumFractionDigits: 2, maximumFractionDigits: 2 }` for XLM
 * amounts, or `{ maximumFractionDigits: 0 }` for whole-unit volumes).
 */
export function formatAmount(
  value: number | string,
  language: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(resolveLocale(language), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  }).format(n);
}

/**
 * Format a date/time for display in the active locale. Accepts a Date, an ISO
 * string, or an epoch value; an unparseable input is returned as-is rather
 * than throwing or rendering "Invalid Date".
 */
export function formatDate(
  value: Date | string | number,
  language: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(resolveLocale(language), options).format(d);
}

/**
 * Hook that binds the formatters to the current language, so components can
 * call `formatAmount(value, opts?)` / `formatDate(value, opts?)` without
 * threading the locale through every call site. Re-memoized when the language
 * changes, which is what makes a language switch reformat every value on screen.
 */
export function useFormatters() {
  const { language } = useLanguage();
  return useMemo(() => {
    const lang: SupportedLanguage = language;
    return {
      locale: resolveLocale(lang),
      formatAmount: (value: number | string, options?: Intl.NumberFormatOptions) =>
        formatAmount(value, lang, options),
      formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
        formatDate(value, lang, options),
    };
  }, [language]);
}
