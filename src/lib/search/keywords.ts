/**
 * Keyword expansion for cross-border job search.
 *
 * A Swedish search term must also match Norwegian/Danish/Finnish/English
 * postings, so each keyword is expanded with its translations before being
 * passed to the keyword-filtered RPC. The translator is injected so the
 * expansion logic stays pure and unit-testable.
 */

export type KeywordTranslator = (
  keyword: string,
  targetLanguage: "sv" | "no" | "da" | "fi" | "en",
) => Promise<string>;

const TARGET_LANGUAGES = ["no", "da", "fi", "en", "sv"] as const;

/**
 * Expands keywords with their translations into a deduplicated,
 * lowercased set. Translation failures fall back to the original keywords
 * only — a broken translator must never break the search.
 */
export async function expandKeywordsWithTranslations(
  keywords: readonly string[],
  translate: KeywordTranslator,
): Promise<string[]> {
  const cleaned = keywords
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (cleaned.length === 0) return [];

  const unionSet = new Set<string>(cleaned.map((k) => k.toLowerCase()));

  try {
    const translations = await Promise.all(
      cleaned.flatMap((kw) =>
        TARGET_LANGUAGES.map((lang) => translate(kw, lang)),
      ),
    );
    for (const t of translations) {
      const trimmed = t.trim().toLowerCase();
      if (trimmed.length > 0) {
        unionSet.add(trimmed);
      }
    }
  } catch (err) {
    console.warn("[expandKeywordsWithTranslations] Translation failed:", err);
  }

  return Array.from(unionSet);
}
