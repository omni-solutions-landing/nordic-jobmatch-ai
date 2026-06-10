/**
 * Search result ranking.
 *
 * Cross-border searches (no specific country chosen) are ordered by country
 * priority first — SE > FI > NO > DK, per product decision 2026-06-10 — then
 * by relevance within each country. Country-specific searches skip the
 * priority and rank purely by relevance (the country filter already applied).
 */

export const COUNTRY_PRIORITY: Record<string, number> = {
  SE: 0,
  FI: 1,
  NO: 2,
  DK: 3,
};

export interface RankableJob {
  readonly country: string;
  /** Cosine similarity for query searches; null for browse/keyword mode. */
  readonly similarity: number | null;
  /** ISO timestamp — fallback ordering when similarity is unavailable. */
  readonly created_at?: string;
}

function relevanceCompare(a: RankableJob, b: RankableJob): number {
  if (a.similarity !== null && b.similarity !== null) {
    return b.similarity - a.similarity;
  }
  // Browse/keyword mode: newest first.
  return Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "");
}

/**
 * Returns a new array ordered by country priority (when enabled) and
 * relevance/recency, truncated to `limit`.
 */
export function rankSearchResults<T extends RankableJob>(
  results: readonly T[],
  options: { readonly applyCountryPriority: boolean; readonly limit: number },
): T[] {
  const sorted = [...results].sort((a, b) => {
    if (options.applyCountryPriority) {
      const prioA = COUNTRY_PRIORITY[a.country] ?? 99;
      const prioB = COUNTRY_PRIORITY[b.country] ?? 99;
      if (prioA !== prioB) return prioA - prioB;
    }
    return relevanceCompare(a, b);
  });
  return sorted.slice(0, Math.max(0, options.limit));
}
