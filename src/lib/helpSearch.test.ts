import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en";
import es from "@/i18n/locales/es";
import { searchHelp, type HelpCategory } from "./helpSearch";

const esCategories = es.help.categories as unknown as HelpCategory[];
const enCategories = en.help.categories as unknown as HelpCategory[];

describe("searchHelp", () => {
  it("returns everything for an empty search", () => {
    expect(searchHelp(esCategories, "   ")).toBe(esCategories);
  });

  it("ignores accents and capitals", () => {
    const found = searchHelp(esCategories, "CREDITO");
    expect(found.some((category) => category.id === "credit")).toBe(true);
  });

  it("requires every word and drops empty categories", () => {
    const found = searchHelp(esCategories, "frase semilla");
    expect(found.map((category) => category.id)).toContain("safety");
    expect(found.every((category) => category.items.length > 0)).toBe(true);
    expect(searchHelp(esCategories, "semilla palabrainexistente")).toEqual([]);
  });
});

describe("help content", () => {
  it("has the same structure in Spanish and English", () => {
    const shape = (categories: HelpCategory[]) =>
      categories.map((category) => ({
        id: category.id,
        links: category.items.map((item) => item.link ?? null),
      }));
    expect(shape(enCategories)).toEqual(shape(esCategories));
  });

  it("gives every link a label", () => {
    for (const category of [...esCategories, ...enCategories]) {
      for (const item of category.items) {
        expect(Boolean(item.link)).toBe(Boolean(item.link_label));
      }
    }
  });

  it("does not promise that funds are absolutely safe", () => {
    const text = JSON.stringify(es.help).toLowerCase();
    expect(text).not.toContain("absolutamente");
    expect(text).toContain("auditoría");
  });
});
