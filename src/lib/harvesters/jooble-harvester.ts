/**
 * Jooble Harvester — Jooble partner API (all four Nordic countries)
 *
 * IMPORTANT (verified 2026-06-10): the country endpoints
 * (https://se.jooble.org/api/{key} etc.) return 403 for our key — Jooble API
 * keys are scoped to the site they were registered on, and ours is scoped to
 * the main https://jooble.org. The main endpoint accepts a `location` filter,
 * so this harvester makes exactly ONE request per country per run against
 * jooble.org (4 requests total — the key has a 500-request budget, so no
 * pagination loops).
 *
 * Skips gracefully (warn + empty result) when JOOBLE_API_KEY is unset.
 *
 * @module Harvester — runs server-side only.
 */

import type { TablesInsert } from "@/lib/database.types";
import { ok, fail } from "@/lib/fp/result";
import {
  HarvesterDefinition,
  executeHarvestPipeline,
  extractUnstructuredData,
  type UnifiedHarvestResult,
} from "./harvester-pipeline";

// ─── Configuration ───────────────────────────────────────────────────────────

const PLATFORM_NAME = "jooble";
const JOOBLE_API_BASE = "https://jooble.org/api";
/** Jooble returns at most one page (~20 jobs) per request. */
const MAX_JOBS_PER_COUNTRY = 20;

const COUNTRIES = [
  { code: "SE", language: "sv", locationQuery: "Sweden" },
  { code: "NO", language: "no", locationQuery: "Norway" },
  { code: "DK", language: "da", locationQuery: "Denmark" },
  { code: "FI", language: "fi", locationQuery: "Finland" },
] as const;

type CountryCode = (typeof COUNTRIES)[number]["code"];
type LanguageCode = (typeof COUNTRIES)[number]["language"];

const COUNTRY_LANGUAGE: Record<CountryCode, LanguageCode> = {
  SE: "sv",
  NO: "no",
  DK: "da",
  FI: "fi",
};

// ─── Types ───────────────────────────────────────────────────────────────────

/** One job as returned by the Jooble API. */
interface JoobleApiJob {
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
  id?: string | number;
}

interface JoobleApiResponse {
  totalCount?: number;
  jobs?: JoobleApiJob[];
}

/** Raw ad shape handed to mapToSchema — a Jooble job tagged with its country. */
export interface RawJoobleAd {
  title: string;
  link: string;
  description: string;
  company?: string;
  location?: string;
  salary?: string;
  country: CountryCode;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strips HTML tags/entities from Jooble snippets (they embed <b> markers). */
function stripSnippet(snippet: string): string {
  return snippet
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds a stable dedup URL. Jooble's `link` carries volatile tracking
 * params (ckey, pos, …) that change between requests and would defeat the
 * source_url UNIQUE constraint, so prefer the bare /desc/{id} form.
 */
function stableJobUrl(job: JoobleApiJob): string | null {
  if (job.id !== undefined && String(job.id).trim().length > 0) {
    return `https://jooble.org/desc/${String(job.id).trim()}`;
  }
  if (job.link) {
    return job.link.split("?")[0] ?? job.link;
  }
  return null;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchJoobleJobsRaw(
  limit: number,
  q?: string,
): Promise<RawJoobleAd[]> {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.warn(
      "[JoobleHarvester] JOOBLE_API_KEY is not set — skipping Jooble harvest.",
    );
    return [];
  }

  const perCountry = Math.min(
    MAX_JOBS_PER_COUNTRY,
    Math.max(1, Math.ceil(limit / COUNTRIES.length)),
  );
  const ads: RawJoobleAd[] = [];

  for (const country of COUNTRIES) {
    try {
      const response = await fetch(`${JOOBLE_API_BASE}/${apiKey.trim()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        body: JSON.stringify({
          keywords: q?.trim() ?? "",
          location: country.locationQuery,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        console.warn(
          `[JoobleHarvester] Jooble API returned ${response.status} for ${country.code} — skipping country.`,
        );
        continue;
      }

      const data: JoobleApiResponse = await response.json();
      let taken = 0;

      for (const job of data.jobs ?? []) {
        if (taken >= perCountry) break;
        const url = stableJobUrl(job);
        if (!job.title || !url) continue;

        ads.push({
          title: job.title.trim(),
          link: url,
          description: stripSnippet(job.snippet ?? "") || job.title.trim(),
          company: job.company?.trim() || undefined,
          location: job.location?.trim() || undefined,
          salary: job.salary?.trim() || undefined,
          country: country.code,
        });
        taken++;
      }
    } catch (err) {
      console.warn(
        `[JoobleHarvester] Fetch error for ${country.code} — skipping country:`,
        err,
      );
    }
  }

  return ads;
}

// ─── Harvester Definition ────────────────────────────────────────────────────

export const joobleHarvester: HarvesterDefinition<
  RawJoobleAd,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: PLATFORM_NAME,
  defaultCountry: "SE",
  defaultLanguage: "en",
  fetchRaw: async (limit, lookbackMinutes, q) => {
    try {
      const ads = await fetchJoobleJobsRaw(limit, q);
      return ok(ads);
    } catch (error) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
  mapToSchema: async (rawAd) => {
    try {
      const aiData = await extractUnstructuredData(
        rawAd.description,
        PLATFORM_NAME,
      );
      // Prefer AI-extracted structured salary; fall back to Jooble's raw
      // salary string; otherwise keep an empty object.
      const aiSalary = aiData.salary_info;
      const aiSalaryHasData =
        typeof aiSalary === "object" &&
        aiSalary !== null &&
        !Array.isArray(aiSalary) &&
        Object.keys(aiSalary).length > 0;
      const salaryInfo = aiSalaryHasData
        ? aiSalary
        : rawAd.salary
          ? { raw: rawAd.salary }
          : {};

      return ok({
        title: rawAd.title,
        company: rawAd.company || "Jooble Partner",
        description: rawAd.description,
        location: rawAd.location || rawAd.country,
        country: rawAd.country,
        source_url: rawAd.link,
        original_language: COUNTRY_LANGUAGE[rawAd.country],
        hard_requirements: aiData.hard_requirements,
        salary_info: salaryInfo,
        expires_at: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        source_platform: PLATFORM_NAME,
      });
    } catch (error) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
};

// ─── Legacy thin wrapper ─────────────────────────────────────────────────────

export async function harvestJoobleJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<UnifiedHarvestResult> {
  const result = await executeHarvestPipeline(joobleHarvester, {
    limit,
    lookbackMinutes: publishedAfterMinutes,
    q,
  });

  if (result.success) {
    return result.value;
  }
  throw result.error;
}
