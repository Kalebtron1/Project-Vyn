import { describe, it, expect } from "vitest";
import { DEFAULT_LANGUAGE, resolveStoredLanguage } from "./config";

describe("resolveStoredLanguage", () => {
  it("keeps supported locales and falls back when the stored value is invalid", () => {
    expect(resolveStoredLanguage("en")).toBe("en");
    expect(resolveStoredLanguage("es")).toBe("es");
    expect(resolveStoredLanguage("fr")).toBe(DEFAULT_LANGUAGE);
    expect(resolveStoredLanguage("EN")).toBe(DEFAULT_LANGUAGE);
    expect(resolveStoredLanguage(null)).toBe(DEFAULT_LANGUAGE);
    expect(resolveStoredLanguage("")).toBe(DEFAULT_LANGUAGE);
  });
});
