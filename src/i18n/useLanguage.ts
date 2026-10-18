/**
 * useLanguage — thin wrapper around i18next for language switching.
 * Persists the choice to localStorage so reloads and new tabs reuse it (#70).
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_STORAGE_KEY,
  resolveStoredLanguage,
  type SupportedLanguage,
} from "./config";

export function useLanguage() {
  const { i18n } = useTranslation();

  // Other open tabs write the same localStorage key; pick up that change here.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      const next = resolveStoredLanguage(event.newValue);
      if (next !== i18n.language) {
        void i18n.changeLanguage(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [i18n]);

  return {
    language: i18n.language as SupportedLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
    changeLanguage: (lang: SupportedLanguage) => {
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      } catch {
        /* localStorage blocked — language still switches for this session */
      }
      return i18n.changeLanguage(lang);
    },
  };
}
