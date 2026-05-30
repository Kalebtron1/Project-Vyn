/**
 * useLanguage — thin wrapper around i18next for language switching.
 *
 * Usage:
 *   const { language, changeLanguage, supportedLanguages } = useLanguage();
 */

import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "./config";

const STORAGE_KEY = "vinculo_language";

export function useLanguage() {
  const { i18n } = useTranslation();

  const changeLanguage = (lang: SupportedLanguage) => {
    localStorage.setItem(STORAGE_KEY, lang);
    return i18n.changeLanguage(lang);
  };

  return {
    language: i18n.language as SupportedLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
    changeLanguage,
  };
}
