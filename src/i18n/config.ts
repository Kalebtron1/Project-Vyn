/**
 * i18n configuration

 - Default language: Spanish (es)
 * Fallback language: Spanish (es)
 * Namespace: "translation" (single namespace, flat structure)
 * Missing key behavior: returns the key itself so nothing silently breaks
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
import fr from "./locales/fr";

export const DEFAULT_LANGUAGE = "es";
export const SUPPORTED_LANGUAGES = ["es", "en", "fr"] as const;
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
    fr: { translation: fr },
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
