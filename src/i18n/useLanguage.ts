/**
 * useLanguage — thin wrapper around i18next for language switching.
 *
 * Usage:
 *   const { language, changeLanguage, supportedLanguages } = useLanguage();
 *
 * To add a new locale:
 *   1. Create src/i18n/locales/<lang>.ts
 *   2. Register it in src/i18n/config.ts
 *   3. Add the lang code to SUPPORTED_LANGUAGES in config.ts
 *   — changeLanguage() will work automatically.
 */

import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, LANGUAGE_STORAGE_KEY, type SupportedLanguage } from "./config";

export function useLanguage() {
  const { i18n } = useTranslation();

  return {
    /** Current active language code, e.g. "es" */
    language: i18n.language as SupportedLanguage,
    /** All supported language codes */
    supportedLanguages: SUPPORTED_LANGUAGES,
    /** Switch the active language (persisted to localStorage). Resolves when resources are loaded. */
    changeLanguage: (lang: SupportedLanguage) => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      return i18n.changeLanguage(lang);
    },
  };
}
