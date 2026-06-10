import { describe, expect, it, vi } from "vitest";
import {
  expandKeywordsWithTranslations,
  type KeywordTranslator,
} from "./keywords";

const dictionaryTranslator: KeywordTranslator = async (keyword, lang) => {
  const dictionary: Record<string, Record<string, string>> = {
    svetsare: {
      no: "sveiser",
      da: "svejser",
      fi: "hitsaaja",
      en: "welder",
      sv: "svetsare",
    },
  };
  return dictionary[keyword.toLowerCase()]?.[lang] ?? keyword;
};

describe("expandKeywordsWithTranslations", () => {
  it("returns an empty array for no keywords", async () => {
    const translate = vi.fn();
    expect(await expandKeywordsWithTranslations([], translate)).toEqual([]);
    expect(await expandKeywordsWithTranslations(["  ", ""], translate)).toEqual([]);
    expect(translate).not.toHaveBeenCalled();
  });

  it("unions originals with translations, lowercased and deduplicated", async () => {
    const result = await expandKeywordsWithTranslations(
      ["Svetsare"],
      dictionaryTranslator,
    );
    expect(result).toEqual(
      expect.arrayContaining(["svetsare", "sveiser", "svejser", "hitsaaja", "welder"]),
    );
    // "svetsare" appears as original AND sv-translation — only once in output
    expect(result.filter((k) => k === "svetsare")).toHaveLength(1);
  });

  it("ignores empty translation results", async () => {
    const emptyTranslator: KeywordTranslator = async () => "  ";
    const result = await expandKeywordsWithTranslations(["truck"], emptyTranslator);
    expect(result).toEqual(["truck"]);
  });

  it("falls back to the original keywords when the translator throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const brokenTranslator: KeywordTranslator = async () => {
      throw new Error("quota exhausted");
    };
    const result = await expandKeywordsWithTranslations(
      ["Svetsare", "CE"],
      brokenTranslator,
    );
    expect(result).toEqual(["svetsare", "ce"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("expands multiple keywords independently", async () => {
    const translate = vi.fn(async (kw: string, lang: string) => `${kw}-${lang}`);
    const result = await expandKeywordsWithTranslations(["a1", "b2"], translate);
    expect(result).toContain("a1");
    expect(result).toContain("b2");
    expect(result).toContain("a1-no");
    expect(result).toContain("b2-fi");
    expect(translate).toHaveBeenCalledTimes(10); // 2 keywords × 5 languages
  });
});
