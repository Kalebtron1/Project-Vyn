/**
 * i18n configuration
 *
 * - Default language: Spanish (es)
 * - Fallback language: Spanish (es)
 * - Namespace: "translation" (single namespace, flat structure)
 * - Missing key behavior: returns the key path itself (e.g. "wallet_setup.error_generic")
 *   so the UI never silently shows a blank string — a visible key path signals a gap.
 *
 * Fallback chain for a missing key in locale "en":
 *   1. Look up key in "en" translation resources.
 *   2. If not found, look up key in fallback locale "es".
 *   3. If still not found, parseMissingKeyHandler returns the key path as a string.
 *
 * To add a new locale:
 *   1. Create src/i18n/locales/<lang>.ts mirroring the es.ts shape
 *   2. Import it here and add it to the `resources` map
 *   3. Update the `supportedLngs` array
 *
 * To add a new key:
 *   1. Add the key and English value to en.ts
 *   2. Add the key and translated value to es.ts (and any other locales)
 *   3. Never rename or delete a key — change only the value to avoid breaking saved references
 * - Selected locale is restored from localStorage before first render (#70);
 *   invalid stored values fall back to DEFAULT_LANGUAGE.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./locales/es";
import en from "./locales/en";

export const DEFAULT_LANGUAGE = "es";
export const SUPPORTED_LANGUAGES = ["es", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "vinculo_language";

/** Map a raw storage value to a supported locale. Unknown values use Spanish. */
export function resolveStoredLanguage(raw: string | null): SupportedLanguage {
  if (raw && (SUPPORTED_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as SupportedLanguage;
  }
  return DEFAULT_LANGUAGE;
}

function readStoredLanguage(): SupportedLanguage {
  try {
    return resolveStoredLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    /* localStorage blocked or unavailable */
    return DEFAULT_LANGUAGE;
  }
}

const initialLang = readStoredLanguage();

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: initialLang,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],

  interpolation: {
    escapeValue: false,
  },

  parseMissingKeyHandler: (key) => key,
});

export default i18n;
