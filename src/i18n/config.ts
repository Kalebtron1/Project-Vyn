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
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./locales/es";
import en from "./locales/en";

export const DEFAULT_LANGUAGE = "es";
export const SUPPORTED_LANGUAGES = ["es", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Persist the user's language choice across reloads (written by useLanguage).
export const LANGUAGE_STORAGE_KEY = "vinculo_language";

const savedLang = localStorage.getItem(LANGUAGE_STORAGE_KEY);
const initialLang =
  savedLang && (SUPPORTED_LANGUAGES as readonly string[]).includes(savedLang)
    ? (savedLang as SupportedLanguage)
    : DEFAULT_LANGUAGE;

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: initialLang,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,

  interpolation: {
    // React already escapes values — no need for i18next to do it too
    escapeValue: false,
  },

  // Return the key path when a translation is missing so nothing silently breaks
  parseMissingKeyHandler: (key) => key,
});

export default i18n;
