"use server";

/**
 * Search Actions — free-text job search, independent of CV matching.
 *
 * Unlike getMatchesForUser (which needs an active CV), this searches
 * job_postings directly:
 *  - Empty query  → browse: newest non-expired postings.
 *  - With a query → semantic + keyword hybrid: the query text is embedded
 *    (taskType "query") and matched against job_embedding via the existing
 *    match_jobs_with_keywords RPC, with the query keywords expanded to all
 *    Nordic languages for the ILIKE filter. If the keyword filter is too
 *    strict (0 hits), it retries semantically only.
 *
 * @module Server Action — runs exclusively on the server.
 */

import { createServerClient } from "@/lib/supabase/server";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { translateKeyword } from "@/lib/ai/translation";
import { expandKeywordsWithTranslations } from "@/lib/search/keywords";
import { rankSearchResults } from "@/lib/search/ranking";
import { Result, ok, fail } from "@/lib/fp/result";
import type { Database, Json } from "@/lib/database.types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JobSearchResult {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly description: string;
  readonly location: string;
  readonly country: Database["public"]["Enums"]["nordic_country"];
  readonly source_url: string;
  readonly source_platform: string | null;
  readonly salary_info: Json;
  readonly created_at: string;
  /** Cosine similarity to the search query; null in browse mode. */
  readonly similarity: number | null;
}

export interface JobSearchOptions {
  readonly query?: string;
  readonly countries?: string[];
  readonly limit?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const JOB_COLUMNS =
  "id, title, company, description, location, country, source_url, source_platform, salary_info, created_at" as const;

const VALID_COUNTRIES = ["SE", "NO", "DK", "FI"] as const;
type NordicCountry = (typeof VALID_COUNTRIES)[number];

/**
 * Minimum cosine similarity for query searches — per product decision
 * (2026-06-10), only jobs above a 50% match are shown.
 */
const SEARCH_MATCH_THRESHOLD = 0.5;
/** Over-fetch size so country-priority ranking can pick the true top-N. */
const RANKING_POOL_SIZE = 100;

// ─── Keyword-only fallback ───────────────────────────────────────────────────

/** Strips characters that would break PostgREST .or() filter syntax. */
function sanitizeForIlike(keyword: string): string {
  return keyword.replace(/[^\p{L}\p{N}\s-]/gu, "").trim();
}

/**
 * Plain ILIKE search over title/description, newest first. Used when the
 * query embedding cannot be generated (missing GEMINI_API_KEY, quota) so the
 * search page keeps working — just without semantic ranking.
 */
async function keywordOnlySearch(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  opts: {
    keywords: string[];
    countries: readonly NordicCountry[];
    limit: number;
  },
): Promise<Result<JobSearchResult[], Error>> {
  const patterns = opts.keywords
    .map(sanitizeForIlike)
    .filter((k) => k.length > 1)
    .slice(0, 25);

  const applyCountryPriority = opts.countries.length !== 1;

  let query = supabase
    .from("job_postings")
    .select(JOB_COLUMNS)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(applyCountryPriority ? RANKING_POOL_SIZE : opts.limit);

  if (patterns.length > 0) {
    query = query.or(
      patterns
        .flatMap((k) => [`title.ilike.%${k}%`, `description.ilike.%${k}%`])
        .join(","),
    );
  }
  if (opts.countries.length > 0) {
    query = query.in("country", [...opts.countries]);
  }

  const { data, error } = await query;
  if (error) {
    return fail(new Error(`Jobbsökningen misslyckades: ${error.message}`));
  }
  return ok(
    rankSearchResults(
      (data ?? []).map((job) => ({ ...job, similarity: null })),
      { applyCountryPriority, limit: opts.limit },
    ),
  );
}

// ─── Main Action ─────────────────────────────────────────────────────────────

export async function searchJobs(
  options: JobSearchOptions = {},
): Promise<Result<JobSearchResult[], Error>> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return fail(new Error("Du måste vara inloggad för att söka jobb."));
    }

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const countries = (options.countries ?? [])
      .map((c) => c.toUpperCase())
      .filter((c): c is NordicCountry =>
        (VALID_COUNTRIES as readonly string[]).includes(c),
      );
    const query = options.query?.trim() ?? "";

    // Country priority (SE > FI > NO > DK) applies to cross-border results
    // only; a country-specific search keeps pure relevance/recency order.
    const applyCountryPriority = countries.length !== 1;

    // ── Browse mode: no query → newest postings ──
    if (query.length === 0) {
      let browse = supabase
        .from("job_postings")
        .select(JOB_COLUMNS)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("created_at", { ascending: false })
        .limit(applyCountryPriority ? RANKING_POOL_SIZE : limit);
      if (countries.length > 0) {
        browse = browse.in("country", countries);
      }

      const { data, error } = await browse;
      if (error) {
        return fail(new Error(`Jobbsökningen misslyckades: ${error.message}`));
      }
      return ok(
        rankSearchResults(
          (data ?? []).map((job) => ({ ...job, similarity: null })),
          { applyCountryPriority, limit },
        ),
      );
    }

    // ── Search mode: semantic + keyword hybrid ──
    const rawKeywords = query
      .split(/[,\s]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 1);
    const matchKeywords = await expandKeywordsWithTranslations(
      rawKeywords,
      translateKeyword,
    );

    // Embedding the query needs Gemini. If that fails (missing key, quota),
    // degrade to keyword-only ILIKE search instead of failing the page.
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await generateEmbedding(query, { taskType: "query" });
    } catch (err) {
      console.warn(
        "[searchJobs] Query embedding failed — falling back to keyword-only search:",
        err,
      );
    }

    if (!queryEmbedding) {
      return keywordOnlySearch(supabase, {
        keywords: matchKeywords.length > 0 ? matchKeywords : [query],
        countries,
        limit,
      });
    }

    const embeddingString = `[${queryEmbedding.join(",")}]`;

    // The RPC supports a single country filter; multi-country selections are
    // over-fetched and filtered here (same approach as getMatchesForUser).
    const filterCountry = countries.length === 1 ? countries[0] : undefined;
    const matchCount = applyCountryPriority ? RANKING_POOL_SIZE : limit;

    const runRpc = (keywords: string[], threshold: number) =>
      supabase.rpc("match_jobs_with_keywords", {
        query_embedding: embeddingString,
        match_keywords: keywords,
        match_threshold: threshold,
        match_count: matchCount,
        filter_country: filterCountry,
      });

    // Keyword-filtered first; pure semantic fallback when the keyword
    // filter is too strict. Both respect the 50% relevance floor.
    const first = await runRpc(matchKeywords, SEARCH_MATCH_THRESHOLD);
    if (first.error) {
      return fail(new Error(`Jobbsökningen misslyckades: ${first.error.message}`));
    }
    let hits = first.data;
    if (!hits || hits.length === 0) {
      const retry = await runRpc([], SEARCH_MATCH_THRESHOLD);
      if (retry.error) {
        return fail(
          new Error(`Jobbsökningen misslyckades: ${retry.error.message}`),
        );
      }
      hits = retry.data;
    }

    let filteredHits = hits ?? [];
    if (countries.length > 1) {
      filteredHits = filteredHits.filter((h) => countries.includes(h.country));
    }
    // Rank the full pool (country priority + relevance), THEN take top-N.
    const rankedHits = rankSearchResults(filteredHits, {
      applyCountryPriority,
      limit,
    });
    if (rankedHits.length === 0) {
      return ok([]);
    }

    // The RPC returns a slim row — fetch full posting details for the cards.
    const ids = rankedHits.map((h) => h.id);
    const { data: jobs, error: jobsError } = await supabase
      .from("job_postings")
      .select(JOB_COLUMNS)
      .in("id", ids);
    if (jobsError) {
      return fail(new Error(`Jobbsökningen misslyckades: ${jobsError.message}`));
    }

    const jobsById = new Map((jobs ?? []).map((j) => [j.id, j]));
    const results: JobSearchResult[] = [];
    for (const hit of rankedHits) {
      const job = jobsById.get(hit.id);
      if (!job) continue;
      results.push({ ...job, similarity: hit.similarity });
    }

    return ok(results);
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}
