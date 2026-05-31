/**
 * i18n configuration
 *
 * - Default language: Spanish (es)
 * - Fallback language: Spanish (es)
 * - Namespace: "translation" (single namespace, flat structure)
 * - Missing key behavior: returns the key itself so nothing silently breaks
 *
 * To add a new locale:
 *   1. Create src/i18n/locales/<lang>.ts mirroring the es.ts shape
 *   2. Import it here and add it to the `resources` map
 *   3. Update the `supportedLngs` array
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./locales/es";
import en from "./locales/en";

export const DEFAULT_LANGUAGE = "es";
export const SUPPORTED_LANGUAGES = ["es", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: DEFAULT_LANGUAGE,
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
