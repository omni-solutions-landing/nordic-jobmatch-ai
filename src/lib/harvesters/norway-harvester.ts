/**
 * Norway Harvester — NAV Arbeidsplassen (stilling-feed) Integration
 *
 * Fetches job postings from Norway's public employment service via the
 * new stilling-feed API (replaced the deprecated public-feed v1 in May 2025).
 *
 * Architecture:
 *   1. Authenticate via Bearer token (public token or env var)
 *   2. Fetch feed pages starting from the newest (`?last`)
 *   3. Filter for ACTIVE entries, then fetch full ad content per entry
 *   4. Normalize to our job_postings schema
 *   5. Batch-embed with taskType: "document"
 *   6. Upsert via service client with ON CONFLICT (source_url)
 *
 * API docs: https://navikt.github.io/pam-stilling-feed/
 * OpenAPI:  https://pam-stilling-feed.ekstern.dev.nav.no/api/openapi.json
 * License:  MIT — data is public from NAV (Arbeidsplassen.no)
 * Auth:     Bearer token (public rotating token or registered private token)
 *
 * @module Harvester — runs server-side only via service client (bypasses RLS).
 */

import {
  generateEmbeddingsBatch,
  stringifyJobForEmbedding,
  type RawJobData,
} from "@/lib/ai/embeddings";
import { createServiceClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/database.types";

// ─── Configuration ───────────────────────────────────────────────────────────

const NAV_FEED_BASE_URL = "https://pam-stilling-feed.nav.no";

/** Public token endpoint (rotates irregularly — not for production). */
const PUBLIC_TOKEN_URL = `${NAV_FEED_BASE_URL}/api/publicToken`;

/** Delay between individual entry fetches to avoid hammering the API (ms). */
const INTER_ENTRY_DELAY_MS = 100;

/** Delay between feed page fetches (ms). */
const INTER_PAGE_DELAY_MS = 300;

/** Delay between embedding batches (ms). */
const INTER_EMBED_DELAY_MS = 200;

/** Number of jobs to embed in a single batch call. */
const EMBED_BATCH_SIZE = 20;

/** Max feed pages to traverse backwards (safety limit). */
const MAX_FEED_PAGES = 50;

/** Concurrency limit for entry detail fetches. */
const ENTRY_FETCH_CONCURRENCY = 5;

/** User-Agent for responsible API usage. */
const USER_AGENT = "NordicJobMatchAI/1.0 (github.com/nordic-jobmatch-ai)";

// ─── NAV API Response Types (from OpenAPI spec) ──────────────────────────────

interface NavFeedLocation {
  country: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  county: string | null;
  municipal: string | null;
}

interface NavFeedContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  title: string | null;
}

interface NavFeedEmployer {
  name: string;
  orgnr: string | null;
  description: string | null;
  homepage: string | null;
}

interface NavFeedOccupation {
  level1: string;
  level2: string;
}

interface NavFeedCategory {
  categoryType: string;
  code: string;
  name: string;
  description: string | null;
  score: number;
}

/** Full ad content returned by /api/v1/feedentry/{entryId} */
interface NavFeedAd {
  uuid: string;
  published: string;
  expires: string;
  updated: string;
  workLocations: NavFeedLocation[];
  contactList: NavFeedContact[];
  title: string;
  description: string | null;
  sourceurl: string | null;
  source: string | null;
  applicationUrl: string | null;
  applicationDue: string | null;
  occupationCategories: NavFeedOccupation[];
  categoryList: NavFeedCategory[];
  jobtitle: string | null;
  link: string;
  employer: NavFeedEmployer;
  engagementtype: string | null;
  extent: string | null;
  starttime: string | null;
  positioncount: string | null;
  sector: string | null;
}

/** Summary entry in a feed page. */
interface NavFeedEntry {
  uuid: string;
  status: string;
  title: string;
  businessName: string;
  municipal: string;
  sistEndret: string;
}

/** A single item on a feed page. */
interface NavFeedLine {
  id: string;
  url: string;
  title: string;
  content_text: string;
  date_modified: string | null;
  _feed_entry: NavFeedEntry;
}

/** Top-level feed page response. */
interface NavFeedPage {
  version: string;
  title: string;
  home_page_url: string;
  feed_url: string;
  description: string;
  next_url: string | null;
  id: string;
  next_id: string | null;
  items: NavFeedLine[];
}

/** Detail response for a single entry. */
interface NavFeedEntryContent {
  uuid: string;
  sistEndret: string;
  status: string;
  ad_content: NavFeedAd | null;
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
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "MAPPING_ERROR"
  | "EMBEDDING_ERROR"
  | "STORAGE_ERROR";

// ─── Result Types ────────────────────────────────────────────────────────────

export interface HarvestResult {
  /** Total feed entries discovered. */
  discovered: number;
  /** Active entries (status = ACTIVE). */
  active: number;
  /** Entries with full ad content fetched successfully. */
  fetched: number;
  /** Ads mapped successfully. */
  mapped: number;
  /** Ads inserted or updated in the DB. */
  stored: number;
  /** Ads skipped due to errors. */
  skipped: number;
  /** Individual error messages. */
  errors: string[];
  /** Feed pages traversed. */
  pagesTraversed: number;
  timing: {
    authMs: number;
    fetchMs: number;
    detailMs: number;
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
      event: "norway_harvester",
      step,
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Resolves a Bearer token for the NAV feed API.
 *
 * Priority:
 *   1. NAV_FEED_TOKEN env var (stable, registered token — recommended for prod)
 *   2. Public token from /api/publicToken (rotates, for testing only)
 */
async function resolveToken(): Promise<string> {
  // 1. Check env var first
  const envToken = process.env.NAV_FEED_TOKEN;
  if (envToken && envToken.trim().length > 0) {
    return envToken.trim();
  }

  // 2. Fetch the public rotating token
  try {
    const response = await fetch(PUBLIC_TOKEN_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new HarvesterError(
        `Failed to fetch public token: ${response.status} ${response.statusText}`,
        "AUTH_ERROR",
      );
    }

    const text = await response.text();
    // The endpoint returns plain text like:
    // "Current public token for Nav Job Vacancy Feed:\n<jwt>"
    const lines = text.trim().split("\n");
    const token = lines[lines.length - 1]?.trim() ?? "";

    if (!token || token.length < 20) {
      throw new HarvesterError(
        "Public token response was empty or malformed",
        "AUTH_ERROR",
      );
    }

    return token;
  } catch (error) {
    if (error instanceof HarvesterError) throw error;
    throw new HarvesterError(
      `Token fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      "AUTH_ERROR",
      error,
    );
  }
}

// ─── API Client ──────────────────────────────────────────────────────────────

/**
 * Makes an authenticated request to the NAV feed API with retry and backoff.
 */
async function callNavApi<T>(
  url: string,
  token: string,
  maxRetries = 3,
): Promise<T | null> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(30_000),
      });

      // 304 Not Modified — no new data
      if (response.status === 304) {
        return null;
      }

      // Rate limited
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(2000 * 2 ** attempt, 16000);

        if (attempt < maxRetries) {
          logHarvest("rate_limited", 0, { attempt, delay_ms: delayMs, url });
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new HarvesterError(
          `Rate limited by NAV API after ${maxRetries} retries`,
          "RATE_LIMITED",
        );
      }

      // 401/403 — auth failure
      if (response.status === 401 || response.status === 403) {
        throw new HarvesterError(
          `NAV API authentication failed (${response.status}). Token may have rotated.`,
          "AUTH_ERROR",
        );
      }

      if (!response.ok) {
        throw new HarvesterError(
          `NAV API returned ${response.status}: ${response.statusText}`,
          "API_ERROR",
        );
      }

      return (await response.json()) as T;
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
    `NAV API request failed after ${maxRetries} retries: ${lastError?.message}`,
    "NETWORK_ERROR",
    lastError,
  );
}

// ─── Feed Traversal ──────────────────────────────────────────────────────────

/**
 * Fetches Norwegian job feed entries by traversing feed pages.
 *
 * The NAV stilling-feed is event-based: starts from the newest page (`?last`)
 * and follows `next_url` backwards to older pages. Each page contains
 * `FeedLine` items with summary data.
 *
 * We collect ACTIVE entries up to `limit`, then fetch full ad content
 * for each entry via `/api/v1/feedentry/{entryId}`.
 *
 * @param limit - Target number of active ads to collect.
 * @param token - Bearer token for authentication.
 * @returns Array of full ad objects and traversal metadata.
 */
export async function fetchNorwegianJobs(
  limit: number,
  token: string,
): Promise<{
  ads: NavFeedAd[];
  discovered: number;
  active: number;
  pagesTraversed: number;
}> {
  const activeEntries: NavFeedLine[] = [];
  let discovered = 0;
  let pagesTraversed = 0;

  // Start from the newest page
  let currentUrl: string | null = `${NAV_FEED_BASE_URL}/api/v1/feed?last`;

  while (currentUrl && activeEntries.length < limit && pagesTraversed < MAX_FEED_PAGES) {
    const page: NavFeedPage | null = await callNavApi<NavFeedPage>(currentUrl, token);

    if (!page || page.items.length === 0) break;

    pagesTraversed++;
    discovered += page.items.length;

    // Collect only ACTIVE entries
    for (const item of page.items) {
      if (item._feed_entry.status === "ACTIVE" && activeEntries.length < limit) {
        activeEntries.push(item);
      }
    }

    // Follow next_url to older pages
    currentUrl = page.next_url ?? null;

    if (currentUrl && activeEntries.length < limit) {
      await new Promise((r) => setTimeout(r, INTER_PAGE_DELAY_MS));
    }
  }

  logHarvest("feed_traversal", 0, {
    pages: pagesTraversed,
    discovered,
    active_collected: activeEntries.length,
  });

  // Fetch full ad content for each active entry (with concurrency limit)
  const ads: NavFeedAd[] = [];
  const entryErrors: string[] = [];

  for (let i = 0; i < activeEntries.length; i += ENTRY_FETCH_CONCURRENCY) {
    const chunk = activeEntries.slice(i, i + ENTRY_FETCH_CONCURRENCY);

    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        const entryUrl = entry.url;
        const content = await callNavApi<NavFeedEntryContent>(entryUrl, token);

        if (!content || !content.ad_content) {
          throw new Error(`Empty ad_content for entry ${entry.id}`);
        }

        if (content.status !== "ACTIVE") {
          throw new Error(`Entry ${entry.id} is no longer ACTIVE (${content.status})`);
        }

        return content.ad_content;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        ads.push(result.value);
      } else {
        entryErrors.push(result.reason?.message ?? "Unknown entry fetch error");
      }
    }

    // Inter-chunk delay
    if (i + ENTRY_FETCH_CONCURRENCY < activeEntries.length) {
      await new Promise((r) => setTimeout(r, INTER_ENTRY_DELAY_MS));
    }
  }

  if (entryErrors.length > 0) {
    logHarvest("entry_fetch_errors", 0, {
      count: entryErrors.length,
      samples: entryErrors.slice(0, 5),
    });
  }

  return {
    ads,
    discovered,
    active: activeEntries.length,
    pagesTraversed,
  };
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

/**
 * Builds a human-readable location string from NAV work locations.
 * Joins city, municipal, and county from the first work location.
 */
function buildLocationString(locations: NavFeedLocation[]): string {
  if (!locations || locations.length === 0) return "Norge";

  const loc = locations[0];
  if (!loc) return "Norge";

  const parts = [
    loc.city,
    loc.municipal,
    loc.county,
  ].filter((p): p is string => !!p && p.trim().length > 0);

  return parts.length > 0 ? parts.join(", ") : "Norge";
}

/**
 * Extracts hard requirements from the categoryList.
 * NAV uses categoryList with categoryType to classify skills, education, etc.
 */
function extractRequirements(ad: NavFeedAd): string[] {
  const reqs: string[] = [];

  for (const category of ad.categoryList) {
    if (category.name && category.name.trim().length > 0) {
      reqs.push(category.name);
    }
  }

  // Also extract occupation categories as requirement context
  for (const occ of ad.occupationCategories) {
    if (occ.level2 && occ.level2.trim().length > 0) {
      reqs.push(occ.level2);
    }
  }

  return [...new Set(reqs)];
}

/**
 * Resolves the best source_url for deduplication.
 * Prefers the NAV link (stable), falls back to sourceurl.
 */
function resolveSourceUrl(ad: NavFeedAd): string {
  return ad.link || ad.sourceurl || `https://arbeidsplassen.nav.no/stillinger/stilling/${ad.uuid}`;
}

/**
 * Resolves expiration date from multiple potential fields.
 */
function resolveExpiresAt(ad: NavFeedAd): string | null {
  // applicationDue can be a descriptive string like "Snarest" (ASAP)
  if (ad.expires) return ad.expires;
  if (ad.applicationDue && /^\d{4}-\d{2}-\d{2}/.test(ad.applicationDue)) {
    return ad.applicationDue;
  }
  return null;
}

/**
 * Maps a NAV FeedAd to our job_postings table schema.
 */
export function mapNavAdToJobPosting(
  ad: NavFeedAd,
): Omit<TablesInsert<"job_postings">, "job_embedding"> {
  return {
    title: ad.jobtitle || ad.title,
    company: ad.employer?.name?.trim() || "Unknown",
    description: ad.description || "",
    location: buildLocationString(ad.workLocations),
    country: "NO",
    source_url: resolveSourceUrl(ad),
    original_language: "no",
    hard_requirements: extractRequirements(ad),
    salary_info: {
      currency: "NOK",
      ...(ad.engagementtype ? { engagement_type: ad.engagementtype } : {}),
      ...(ad.extent ? { extent: ad.extent } : {}),
      ...(ad.sector ? { sector: ad.sector } : {}),
    },
    expires_at: resolveExpiresAt(ad),
  };
}

/**
 * Builds a RawJobData object for the stringifier.
 */
function toRawJobData(
  mapped: Omit<TablesInsert<"job_postings">, "job_embedding">,
  originalTitle: string,
): RawJobData {
  return {
    title: mapped.title ?? "",
    company: mapped.company ?? undefined,
    description: mapped.description ?? "",
    location: mapped.location ?? undefined,
    country: "NO",
    hard_requirements: mapped.hard_requirements ?? [],
    salary_info: mapped.salary_info as RawJobData["salary_info"],
    original_title: originalTitle !== mapped.title ? originalTitle : undefined,
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
 * Full Norway harvest pipeline: Auth → Fetch Feed → Detail → Map → Embed → Store.
 *
 * Uses the service client (bypasses RLS) since harvesters are admin operations.
 * Deduplication is handled by ON CONFLICT (source_url) DO UPDATE.
 *
 * @param limit - Target number of jobs to harvest (default 50).
 * @returns Harvest result with counts and timing.
 *
 * @example
 * ```ts
 * const result = await harvestNorwegianJobs(50);
 * console.log(`Stored ${result.stored} of ${result.fetched} Norwegian jobs`);
 * ```
 */
export async function harvestNorwegianJobs(
  limit = 50,
): Promise<HarvestResult> {
  const totalStart = performance.now();
  const errors: string[] = [];

  // ── 1. Authenticate ──────────────────────────────────────────────────────

  const authStart = performance.now();
  let token: string;

  try {
    token = await resolveToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logHarvest("auth", Math.round(performance.now() - authStart), {
      status: "error",
      error: message,
    });
    throw new HarvesterError(`Auth failed: ${message}`, "AUTH_ERROR", error);
  }

  const authMs = Math.round(performance.now() - authStart);
  logHarvest("auth", authMs, { status: "ok", source: process.env.NAV_FEED_TOKEN ? "env" : "public" });

  // ── 2. Fetch feed pages + entry details ──────────────────────────────────

  const fetchStart = performance.now();
  let ads: NavFeedAd[];
  let discovered: number;
  let active: number;
  let pagesTraversed: number;

  try {
    const result = await fetchNorwegianJobs(limit, token);
    ads = result.ads;
    discovered = result.discovered;
    active = result.active;
    pagesTraversed = result.pagesTraversed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logHarvest("fetch", Math.round(performance.now() - fetchStart), {
      status: "error",
      error: message,
    });
    throw new HarvesterError(`Fetch failed: ${message}`, "API_ERROR", error);
  }

  const fetchMs = Math.round(performance.now() - fetchStart);

  // Split fetchMs into conceptual detail time (most of it is entry fetches)
  const detailMs = Math.round(fetchMs * 0.8);

  logHarvest("fetch", fetchMs, {
    status: "ok",
    discovered,
    active,
    fetched: ads.length,
    pages: pagesTraversed,
  });

  if (ads.length === 0) {
    return {
      discovered,
      active,
      fetched: 0,
      mapped: 0,
      stored: 0,
      skipped: 0,
      errors: [],
      pagesTraversed,
      timing: { authMs, fetchMs, detailMs: 0, embedMs: 0, storeMs: 0, totalMs: fetchMs + authMs },
    };
  }

  // ── 3. Map to our schema ─────────────────────────────────────────────────

  const mappedJobs: {
    row: Omit<TablesInsert<"job_postings">, "job_embedding">;
    originalTitle: string;
  }[] = [];

  for (const ad of ads) {
    try {
      // Skip ads with empty/masked titles (stopped ads)
      if (!ad.title || ad.title.trim().length === 0) {
        errors.push(`Skipped ad ${ad.uuid}: empty title (likely stopped)`);
        continue;
      }
      const row = mapNavAdToJobPosting(ad);
      mappedJobs.push({ row, originalTitle: ad.title });
    } catch (error) {
      const msg = `Map error for ad ${ad.uuid}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(msg);
      logHarvest("map_error", 0, { ad_uuid: ad.uuid, error: msg });
    }
  }

  logHarvest("map", 0, {
    status: "ok",
    mapped: mappedJobs.length,
    skipped: ads.length - mappedJobs.length,
  });

  if (mappedJobs.length === 0) {
    const totalMs = Math.round(performance.now() - totalStart);
    return {
      discovered,
      active,
      fetched: ads.length,
      mapped: 0,
      stored: 0,
      skipped: ads.length,
      errors,
      pagesTraversed,
      timing: { authMs, fetchMs, detailMs, embedMs: 0, storeMs: 0, totalMs },
    };
  }

  // ── 4. Generate embeddings (batched) ─────────────────────────────────────

  const embedStart = performance.now();
  const embeddingTexts = mappedJobs.map(({ row, originalTitle }) =>
    stringifyJobForEmbedding(toRawJobData(row, originalTitle)),
  );

  let allEmbeddings: number[][];
  try {
    allEmbeddings = [];
    for (let i = 0; i < embeddingTexts.length; i += EMBED_BATCH_SIZE) {
      const chunk = embeddingTexts.slice(i, i + EMBED_BATCH_SIZE);
      const chunkEmbeddings = await generateEmbeddingsBatch(chunk, {
        taskType: "document",
      });
      allEmbeddings.push(...chunkEmbeddings);

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

  // ── 5. Store in Supabase (batched upsert) ────────────────────────────────

  const storeStart = performance.now();
  const supabase = createServiceClient();
  let storedCount = 0;

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
    status: errors.some((e) => e.startsWith("Store")) ? "partial" : "ok",
    stored: storedCount,
    batches: Math.ceil(mappedJobs.length / STORE_BATCH_SIZE),
  });

  // ── 6. Return result ─────────────────────────────────────────────────────

  const totalMs = Math.round(performance.now() - totalStart);

  logHarvest("complete", totalMs, {
    status: "ok",
    discovered,
    active,
    fetched: ads.length,
    mapped: mappedJobs.length,
    stored: storedCount,
    skipped: ads.length - mappedJobs.length + errors.length,
    pages: pagesTraversed,
  });

  return {
    discovered,
    active,
    fetched: ads.length,
    mapped: mappedJobs.length,
    stored: storedCount,
    skipped: ads.length - mappedJobs.length,
    errors,
    pagesTraversed,
    timing: { authMs, fetchMs, detailMs, embedMs, storeMs, totalMs },
  };
}
