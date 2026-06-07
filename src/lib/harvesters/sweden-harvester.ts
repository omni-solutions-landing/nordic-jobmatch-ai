/**
 * Sweden Harvester — JobTech Dev (Platsbanken) Integration
 *
 * Fetches job postings from Sweden's public employment service API,
 * normalizes them to our schema, generates embeddings, and stores
 * them in Supabase with deduplication via source_url UNIQUE constraint.
 *
 * API docs: https://jobsearch.api.jobtechdev.se
 * License: Ads are CC0 (public domain)
 * Rate limits: No auth required; be respectful (~1 req/sec)
 *
 * @module Harvester — runs server-side only via service client (bypasses RLS).
 */

import {
  generateEmbedding,
  generateEmbeddingsBatch,
  stringifyJobForEmbedding,
  type RawJobData,
} from "@/lib/ai/embeddings";
import { createServiceClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/database.types";

// ─── Configuration ───────────────────────────────────────────────────────────

const JOBTECH_BASE_URL = "https://jobsearch.api.jobtechdev.se";

/** Max results per API call (API hard limit is 100). */
const API_MAX_LIMIT = 100;

/** Max offset the API allows (hard limit 2000). */
const API_MAX_OFFSET = 2000;

/** Delay between paginated API requests (ms). */
const INTER_PAGE_DELAY_MS = 500;

/** Delay between embedding batches to avoid 429s (ms). */
const INTER_EMBED_DELAY_MS = 200;

/** Number of jobs to embed in a single batch call. */
const EMBED_BATCH_SIZE = 20;

/** User-Agent header for responsible API usage. */
const USER_AGENT = "NordicJobMatchAI/1.0 (github.com/nordic-jobmatch-ai)";

// ─── JobTech API Response Types ──────────────────────────────────────────────

/** Taxonomy item used throughout the JobTech response. */
interface JobTechTaxonomyItem {
  concept_id: string | null;
  label: string;
  legacy_ams_taxonomy_id: string | null;
}

interface JobTechWeightedItem extends JobTechTaxonomyItem {
  weight: number;
}

interface JobTechDescription {
  text: string | null;
  text_formatted: string | null;
  company_information: string | null;
  needs: string | null;
  requirements: string | null;
  conditions: string | null;
}

interface JobTechEmployer {
  phone_number: string | null;
  email: string | null;
  url: string | null;
  organization_number: string | null;
  name: string | null;
  workplace: string | null;
}

interface JobTechAddress {
  municipality: string | null;
  municipality_code: string | null;
  municipality_concept_id: string | null;
  region: string | null;
  region_code: string | null;
  region_concept_id: string | null;
  country: string | null;
  country_code: string | null;
  country_concept_id: string | null;
  street_address: string | null;
  postcode: string | null;
  city: string | null;
  coordinates: [number, number] | null;
}

interface JobTechRequirements {
  skills: JobTechWeightedItem[];
  languages: JobTechWeightedItem[];
  work_experiences: JobTechWeightedItem[];
  education: JobTechWeightedItem[];
  education_level: JobTechWeightedItem[];
}

/** A single job ad hit from the /search endpoint. */
interface JobTechAd {
  id: string;
  external_id: string | null;
  original_id: string | null;
  headline: string;
  description: JobTechDescription;
  employer: JobTechEmployer;
  workplace_address: JobTechAddress;
  webpage_url: string;
  application_deadline: string | null;
  publication_date: string;
  last_publication_date: string | null;
  number_of_vacancies: number;
  employment_type: JobTechTaxonomyItem | null;
  salary_type: JobTechTaxonomyItem | null;
  salary_description: string | null;
  duration: JobTechTaxonomyItem | null;
  working_hours_type: JobTechTaxonomyItem | null;
  scope_of_work: { min: number; max: number } | null;
  occupation: JobTechTaxonomyItem | null;
  occupation_group: JobTechTaxonomyItem | null;
  occupation_field: JobTechTaxonomyItem | null;
  must_have: JobTechRequirements;
  nice_to_have: JobTechRequirements;
  experience_required: boolean;
  driving_license_required: boolean;
  driving_license: JobTechTaxonomyItem[] | null;
  relevance: number;
  removed: boolean;
  removed_date: string | null;
  source_type: string;
  timestamp: number;
}

/** Top-level /search response envelope. */
interface JobTechSearchResponse {
  total: { value: number };
  positions: number;
  query_time_in_millis: number;
  result_time_in_millis: number;
  hits: JobTechAd[];
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export class HarvesterError extends Error {
  constructor(
    message: string,
    public readonly code: HarvesterErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HarvesterError";
  }
}

export type HarvesterErrorCode =
  | "API_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "MAPPING_ERROR"
  | "EMBEDDING_ERROR"
  | "STORAGE_ERROR";

// ─── Result Types ────────────────────────────────────────────────────────────

export interface HarvestResult {
  /** Total ads fetched from the API. */
  fetched: number;
  /** Ads that mapped successfully. */
  mapped: number;
  /** Ads that were inserted or updated in the DB. */
  stored: number;
  /** Ads skipped due to mapping or embedding errors. */
  skipped: number;
  /** Individual error messages for skipped ads. */
  errors: string[];
  /** Latency breakdown in ms. */
  timing: {
    fetchMs: number;
    embedMs: number;
    storeMs: number;
    totalMs: number;
  };
}

// ─── Structured Logging ──────────────────────────────────────────────────────

function logHarvest(
  step: string,
  durationMs: number,
  details?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      event: "sweden_harvester",
      step,
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

// ─── API Client ──────────────────────────────────────────────────────────────

/**
 * Fetches job ads from the JobTech Dev Search API with retry and backoff.
 *
 * @param params - Query parameters for the /search endpoint.
 * @param maxRetries - Max retry attempts for transient failures.
 * @returns Parsed API response.
 */
async function callJobTechApi(
  params: Record<string, string>,
  maxRetries = 3,
): Promise<JobTechSearchResponse> {
  const url = new URL("/search", JOBTECH_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(30_000),
      });

      // Rate limited — back off and retry
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(2000 * 2 ** attempt, 16000);

        if (attempt < maxRetries) {
          logHarvest("rate_limited", 0, {
            attempt,
            delay_ms: delayMs,
            url: url.pathname + url.search,
          });
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new HarvesterError(
          `Rate limited by JobTech API after ${maxRetries} retries`,
          "RATE_LIMITED",
        );
      }

      if (!response.ok) {
        throw new HarvesterError(
          `JobTech API returned ${response.status}: ${response.statusText}`,
          "API_ERROR",
        );
      }

      return (await response.json()) as JobTechSearchResponse;
    } catch (error) {
      if (error instanceof HarvesterError) throw error;

      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * 2 ** attempt, 8000);
        logHarvest("retry", 0, {
          attempt,
          delay_ms: delayMs,
          error: lastError.message,
        });
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
    }
  }

  throw new HarvesterError(
    `JobTech API request failed after ${maxRetries} retries: ${lastError?.message}`,
    "NETWORK_ERROR",
    lastError,
  );
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Fetches Swedish job postings from the JobTech Dev API.
 *
 * Handles pagination automatically. The API allows max 100 results per call
 * and a max offset of 2000, giving a hard ceiling of ~2100 results per harvest.
 *
 * @param limit - Total number of ads to fetch (will be paginated).
 * @param publishedAfterMinutes - Only fetch ads published in the last N minutes.
 *        Defaults to 1440 (24 hours).
 * @returns Array of raw JobTech ad objects.
 */
export async function fetchSwedishJobs(
  limit: number,
  publishedAfterMinutes = 1440,
): Promise<{ ads: JobTechAd[]; totalAvailable: number }> {
  const allAds: JobTechAd[] = [];
  const effectiveLimit = Math.min(limit, API_MAX_OFFSET + API_MAX_LIMIT);
  let offset = 0;
  let totalAvailable = 0;

  while (allAds.length < effectiveLimit) {
    const pageSize = Math.min(
      API_MAX_LIMIT,
      effectiveLimit - allAds.length,
    );

    const response = await callJobTechApi({
      limit: String(pageSize),
      offset: String(offset),
      sort: "pubdate-desc",
      "published-after": String(publishedAfterMinutes),
    });

    totalAvailable = response.total.value;

    if (response.hits.length === 0) break;

    // Filter out removed ads
    const activeAds = response.hits.filter((ad) => !ad.removed);
    allAds.push(...activeAds);

    offset += response.hits.length;

    // Stop if we've exhausted all results or hit the API offset cap
    if (offset >= totalAvailable || offset >= API_MAX_OFFSET) break;

    // Rate-limit politeness delay between pages
    if (allAds.length < effectiveLimit) {
      await new Promise((r) => setTimeout(r, INTER_PAGE_DELAY_MS));
    }
  }

  return { ads: allAds.slice(0, limit), totalAvailable };
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

/**
 * Builds a human-readable location string from the JobTech address.
 * Prioritizes municipality > city > region for specificity.
 */
function buildLocationString(addr: JobTechAddress | null): string {
  if (!addr) return "Sverige";
  const parts = [
    addr.municipality,
    addr.region,
  ].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : "Sverige";
}

/**
 * Extracts hard requirements from the must_have structured data.
 * Combines skills, work experiences, languages, and education labels.
 */
function extractHardRequirements(ad: JobTechAd): string[] {
  const reqs: string[] = [];

  if (ad.must_have) {
    for (const skill of ad.must_have.skills) {
      if (skill.label) reqs.push(skill.label);
    }
    for (const exp of ad.must_have.work_experiences) {
      if (exp.label) reqs.push(exp.label);
    }
    for (const lang of ad.must_have.languages) {
      if (lang.label) reqs.push(lang.label);
    }
    for (const edu of ad.must_have.education) {
      if (edu.label) reqs.push(edu.label);
    }
    for (const level of ad.must_have.education_level) {
      if (level.label) reqs.push(level.label);
    }
  }

  // Driver's license requirement
  if (ad.driving_license_required) {
    if (ad.driving_license && ad.driving_license.length > 0) {
      const classes = ad.driving_license.map((d) => d.label).join(", ");
      reqs.push(`Körkort ${classes}`);
    } else {
      reqs.push("Körkort (driver license)");
    }
  }

  return [...new Set(reqs)]; // Deduplicate
}

/**
 * Builds salary_info JSONB from available JobTech fields.
 */
function buildSalaryInfo(
  ad: JobTechAd,
): Record<string, string> {
  const info: Record<string, string> = {};

  if (ad.salary_type?.label) {
    info.type = ad.salary_type.label;
  }
  if (ad.salary_description) {
    info.description = ad.salary_description;
  }
  info.currency = "SEK";

  return info;
}

/**
 * Maps a raw JobTech API ad to our job_postings table schema.
 *
 * @param ad - Raw ad from the JobTech API.
 * @returns Insert-ready row for the job_postings table (minus embedding).
 */
export function mapJobTechAdToJobPosting(
  ad: JobTechAd,
): Omit<TablesInsert<"job_postings">, "job_embedding"> {
  return {
    title: ad.headline,
    company: ad.employer?.name?.trim() || "Unknown",
    description: ad.description?.text || "",
    location: buildLocationString(ad.workplace_address),
    country: "SE",
    source_url: ad.webpage_url,
    original_language: "sv",
    hard_requirements: extractHardRequirements(ad),
    salary_info: buildSalaryInfo(ad),
    expires_at: ad.application_deadline || ad.last_publication_date || null,
  };
}

/**
 * Builds a RawJobData object for the stringifier from a mapped job.
 */
function toRawJobData(
  mapped: Omit<TablesInsert<"job_postings">, "job_embedding">,
  originalHeadline: string,
): RawJobData {
  return {
    title: mapped.title ?? "",
    company: mapped.company ?? undefined,
    description: mapped.description ?? "",
    location: mapped.location ?? undefined,
    country: "SE",
    hard_requirements: mapped.hard_requirements ?? [],
    salary_info: mapped.salary_info as RawJobData["salary_info"],
    original_title: originalHeadline !== mapped.title ? originalHeadline : undefined,
  };
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Formats a vector as a pgvector-compatible string literal.
 */
function vectorToString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Full Sweden harvest pipeline: Fetch → Map → Embed → Store.
 *
 * Uses the service client (bypasses RLS) since harvesters are admin operations.
 * Deduplication is handled by ON CONFLICT (source_url) DO UPDATE.
 *
 * @param limit - Number of jobs to harvest (default 50).
 * @param publishedAfterMinutes - Only harvest ads published in the last N minutes
 *        (default 1440 = 24 hours).
 * @returns Harvest result with counts and timing.
 *
 * @example
 * ```ts
 * // Harvest the 50 most recent Swedish job postings
 * const result = await harvestSwedishJobs(50);
 * console.log(`Stored ${result.stored} of ${result.fetched} fetched jobs`);
 * ```
 */
export async function harvestSwedishJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
): Promise<HarvestResult> {
  const totalStart = performance.now();
  const errors: string[] = [];

  // ── 1. Fetch from JobTech API ────────────────────────────────────────────

  const fetchStart = performance.now();
  let ads: JobTechAd[];
  let totalAvailable: number;

  try {
    const result = await fetchSwedishJobs(limit, publishedAfterMinutes);
    ads = result.ads;
    totalAvailable = result.totalAvailable;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logHarvest("fetch", Math.round(performance.now() - fetchStart), {
      status: "error",
      error: message,
    });
    throw new HarvesterError(`Fetch failed: ${message}`, "API_ERROR", error);
  }

  const fetchMs = Math.round(performance.now() - fetchStart);
  logHarvest("fetch", fetchMs, {
    status: "ok",
    fetched: ads.length,
    total_available: totalAvailable,
  });

  if (ads.length === 0) {
    return {
      fetched: 0,
      mapped: 0,
      stored: 0,
      skipped: 0,
      errors: [],
      timing: { fetchMs, embedMs: 0, storeMs: 0, totalMs: fetchMs },
    };
  }

  // ── 2. Map to our schema ─────────────────────────────────────────────────

  const mappedJobs: {
    row: Omit<TablesInsert<"job_postings">, "job_embedding">;
    originalHeadline: string;
  }[] = [];

  for (const ad of ads) {
    try {
      const row = mapJobTechAdToJobPosting(ad);
      mappedJobs.push({ row, originalHeadline: ad.headline });
    } catch (error) {
      const msg = `Map error for ad ${ad.id}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(msg);
      logHarvest("map_error", 0, { ad_id: ad.id, error: msg });
    }
  }

  logHarvest("map", 0, {
    status: "ok",
    mapped: mappedJobs.length,
    skipped: ads.length - mappedJobs.length,
  });

  // ── 3. Generate embeddings (batched) ─────────────────────────────────────

  const embedStart = performance.now();
  const embeddingTexts = mappedJobs.map(({ row, originalHeadline }) =>
    stringifyJobForEmbedding(toRawJobData(row, originalHeadline)),
  );

  let allEmbeddings: number[][];
  try {
    // Process in chunks to respect API limits
    allEmbeddings = [];
    for (let i = 0; i < embeddingTexts.length; i += EMBED_BATCH_SIZE) {
      const chunk = embeddingTexts.slice(i, i + EMBED_BATCH_SIZE);
      const chunkEmbeddings = await generateEmbeddingsBatch(chunk, {
        taskType: "document",
      });
      allEmbeddings.push(...chunkEmbeddings);

      // Inter-batch delay to avoid 429s
      if (i + EMBED_BATCH_SIZE < embeddingTexts.length) {
        await new Promise((r) => setTimeout(r, INTER_EMBED_DELAY_MS));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logHarvest("embed", Math.round(performance.now() - embedStart), {
      status: "error",
      error: message,
      batch_size: embeddingTexts.length,
    });
    throw new HarvesterError(
      `Embedding generation failed: ${message}`,
      "EMBEDDING_ERROR",
      error,
    );
  }

  const embedMs = Math.round(performance.now() - embedStart);
  logHarvest("embed", embedMs, {
    status: "ok",
    count: allEmbeddings.length,
    dimensions: allEmbeddings[0]?.length ?? 0,
  });

  // ── 4. Store in Supabase (batched upsert) ────────────────────────────────
  // Uses service client (admin) — harvesters don't run in user context.
  // ON CONFLICT (source_url) DO UPDATE prevents duplicates.

  const storeStart = performance.now();
  const supabase = createServiceClient();
  let storedCount = 0;

  // Upsert in batches of 50 to avoid payload limits
  const STORE_BATCH_SIZE = 50;

  for (let i = 0; i < mappedJobs.length; i += STORE_BATCH_SIZE) {
    const batchRows = mappedJobs
      .slice(i, i + STORE_BATCH_SIZE)
      .map(({ row }, idx) => ({
        ...row,
        job_embedding: vectorToString(allEmbeddings[i + idx] ?? []),
      }));

    const { error: upsertError, count } = await supabase
      .from("job_postings")
      .upsert(batchRows, {
        onConflict: "source_url",
        ignoreDuplicates: false,
        count: "exact",
      });

    if (upsertError) {
      const msg = `Store batch ${Math.floor(i / STORE_BATCH_SIZE) + 1} error: ${upsertError.message}`;
      errors.push(msg);
      logHarvest("store_error", 0, {
        batch: Math.floor(i / STORE_BATCH_SIZE) + 1,
        code: upsertError.code,
        message: upsertError.message,
      });
    } else {
      storedCount += count ?? batchRows.length;
    }
  }

  const storeMs = Math.round(performance.now() - storeStart);
  logHarvest("store", storeMs, {
    status: errors.length === 0 ? "ok" : "partial",
    stored: storedCount,
    batches: Math.ceil(mappedJobs.length / STORE_BATCH_SIZE),
  });

  // ── 5. Return result ─────────────────────────────────────────────────────

  const totalMs = Math.round(performance.now() - totalStart);

  logHarvest("complete", totalMs, {
    status: "ok",
    fetched: ads.length,
    mapped: mappedJobs.length,
    stored: storedCount,
    skipped: ads.length - mappedJobs.length + errors.length,
    total_available: totalAvailable,
  });

  return {
    fetched: ads.length,
    mapped: mappedJobs.length,
    stored: storedCount,
    skipped: ads.length - mappedJobs.length,
    errors,
    timing: { fetchMs, embedMs, storeMs, totalMs },
  };
}
