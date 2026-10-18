import { describe, it, expect } from "vitest";
import { resolveLocale, formatAmount, formatDate } from "./format";

describe("resolveLocale", () => {
  it("passes through a supported language code", () => {
    expect(resolveLocale("es")).toBe("es");
    expect(resolveLocale("en")).toBe("en");
  });

  it("falls back to the default language for an unknown code", () => {
    expect(resolveLocale("fr")).toBe("es");
    expect(resolveLocale("")).toBe("es");
  });
});

describe("formatAmount", () => {
  it("formats the number differently per locale (values switch with locale)", () => {
    // es groups with '.' and uses ',' for decimals; en is the reverse.
    expect(formatAmount(1234.5, "es")).not.toBe(formatAmount(1234.5, "en"));
    expect(formatAmount(1234.5, "en")).toBe("1,234.5");
  });

  it("does not mutate or misround the underlying precision it is asked for", () => {
    expect(formatAmount(1234.567, "en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })).toBe("1,234.57");
  });

  it("honors explicit fraction digits", () => {
    expect(formatAmount(300, "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("300.00");
    expect(formatAmount(1500.9, "en", { maximumFractionDigits: 0 })).toBe("1,501");
  });

  it("returns a non-finite input unchanged instead of 'NaN'", () => {
    expect(formatAmount("...", "en")).toBe("...");
    expect(formatAmount(Number.NaN, "en")).toBe("NaN");
  });
});

describe("formatDate", () => {
  const date = new Date("2026-01-15T14:30:00Z");
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  };

  it("formats the date differently per locale", () => {
    expect(formatDate(date, "es", opts)).not.toBe(formatDate(date, "en", opts));
  });

  it("accepts Date, ISO string, and epoch inputs equivalently", () => {
    const fromString = formatDate("2026-01-15T14:30:00Z", "en", opts);
    const fromEpoch = formatDate(date.getTime(), "en", opts);
    expect(fromString).toBe(formatDate(date, "en", opts));
    expect(fromEpoch).toBe(formatDate(date, "en", opts));
  });

  it("returns an unparseable input unchanged", () => {
    expect(formatDate("not-a-date", "en", opts)).toBe("not-a-date");
  });
});
