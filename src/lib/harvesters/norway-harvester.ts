/**
 * Norway Harvester — NAV Arbeidsplassen (stilling-feed) Integration
 *
 * Fetches job postings from Norway's public employment service via the stilling-feed API.
 *
 * @module Harvester — runs server-side only.
 */

import type { TablesInsert } from "@/lib/database.types";
import { ok, fail } from "@/lib/fp/result";
import {
  HarvesterDefinition,
  executeHarvestPipeline,
  type UnifiedHarvestResult,
} from "./harvester-pipeline";

// ─── Configuration ───────────────────────────────────────────────────────────

const NAV_FEED_BASE_URL = "https://pam-stilling-feed.nav.no";
const PUBLIC_TOKEN_URL = `${NAV_FEED_BASE_URL}/api/publicToken`;
const INTER_ENTRY_DELAY_MS = 100;
const INTER_PAGE_DELAY_MS = 300;
const MAX_FEED_PAGES = 50;
const ENTRY_FETCH_CONCURRENCY = 5;
const USER_AGENT = "NordicJobMatchAI/1.0 (github.com/nordic-jobmatch-ai)";

// ─── NAV API Response Types ──────────────────────────────────────────────────

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

export interface NavFeedAd {
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

interface NavFeedEntry {
  uuid: string;
  status: string;
  title: string;
  businessName: string;
  municipal: string;
  sistEndret: string;
}

interface NavFeedLine {
  id: string;
  url: string;
  title: string;
  content_text: string;
  date_modified: string | null;
  _feed_entry: NavFeedEntry;
}

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

interface NavFeedEntryContent {
  uuid: string;
  sistEndret: string;
  status: string;
  ad_content: NavFeedAd | null;
}

// ─── Authentication ──────────────────────────────────────────────────────────

async function resolveToken(): Promise<string> {
  const envToken = process.env.NAV_FEED_TOKEN;
  if (envToken && envToken.trim().length > 0) {
    return envToken.trim();
  }

  const response = await fetch(PUBLIC_TOKEN_URL, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch public token: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const lines = text.trim().split("\n");
  const token = lines[lines.length - 1]?.trim() ?? "";

  if (!token || token.length < 20) {
    throw new Error("Public token response was empty or malformed");
  }

  return token;
}

// ─── API Client ──────────────────────────────────────────────────────────────

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

      if (response.status === 304) {
        return null;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(2000 * 2 ** attempt, 16000);

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error(`Rate limited by NAV API after ${maxRetries} retries`);
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(`NAV API authentication failed (${response.status}). Token may have rotated.`);
      }

      if (!response.ok) {
        throw new Error(`NAV API returned ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
    }
  }

  throw new Error(`NAV API request failed after ${maxRetries} retries: ${lastError?.message}`);
}

// ─── Feed Traversal ──────────────────────────────────────────────────────────

export async function fetchNorwegianJobsRaw(
  limit: number,
  token: string,
): Promise<NavFeedAd[]> {
  const activeEntries: NavFeedLine[] = [];
  let pagesTraversed = 0;
  let currentUrl: string | null = `${NAV_FEED_BASE_URL}/api/v1/feed?last`;

  while (currentUrl && activeEntries.length < limit && pagesTraversed < MAX_FEED_PAGES) {
    const page: NavFeedPage | null = await callNavApi<NavFeedPage>(currentUrl, token);
    if (!page || page.items.length === 0) break;

    pagesTraversed++;

    for (const item of page.items) {
      if (item._feed_entry.status === "ACTIVE" && activeEntries.length < limit) {
        activeEntries.push(item);
      }
    }

    currentUrl = page.next_url
      ? (page.next_url.startsWith("/") ? `${NAV_FEED_BASE_URL}${page.next_url}` : page.next_url)
      : null;

    if (currentUrl && activeEntries.length < limit) {
      await new Promise((r) => setTimeout(r, INTER_PAGE_DELAY_MS));
    }
  }

  const ads: NavFeedAd[] = [];

  for (let i = 0; i < activeEntries.length; i += ENTRY_FETCH_CONCURRENCY) {
    const chunk = activeEntries.slice(i, i + ENTRY_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        const entryUrl = entry.url.startsWith("/")
          ? `${NAV_FEED_BASE_URL}${entry.url}`
          : entry.url;
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
      }
    }

    if (i + ENTRY_FETCH_CONCURRENCY < activeEntries.length) {
      await new Promise((r) => setTimeout(r, INTER_ENTRY_DELAY_MS));
    }
  }

  return ads;
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

function buildLocationString(locations: NavFeedLocation[]): string {
  if (!locations || locations.length === 0) return "Norge";
  const loc = locations[0];
  if (!loc) return "Norge";

  const parts = [loc.city, loc.municipal, loc.county].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : "Norge";
}

function extractRequirements(ad: NavFeedAd): string[] {
  const reqs: string[] = [];

  for (const category of ad.categoryList) {
    if (category.name && category.name.trim().length > 0) {
      reqs.push(category.name);
    }
  }

  for (const occ of ad.occupationCategories) {
    if (occ.level2 && occ.level2.trim().length > 0) {
      reqs.push(occ.level2);
    }
  }

  return [...new Set(reqs)];
}

function resolveSourceUrl(ad: NavFeedAd): string {
  return ad.link || ad.sourceurl || `https://arbeidsplassen.nav.no/stillinger/stilling/${ad.uuid}`;
}

function resolveExpiresAt(ad: NavFeedAd): string | null {
  if (ad.expires) return ad.expires;
  if (ad.applicationDue && /^\d{4}-\d{2}-\d{2}/.test(ad.applicationDue)) {
    return ad.applicationDue;
  }
  return null;
}

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

// ─── Harvester Definition ────────────────────────────────────────────────────

export const norwayHarvester: HarvesterDefinition<
  NavFeedAd,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: "arbeidsplassen",
  defaultCountry: "NO",
  defaultLanguage: "no",
  fetchRaw: async (limit) => {
    try {
      const token = await resolveToken();
      const ads = await fetchNorwegianJobsRaw(limit, token);
      return ok(ads);
    } catch (error) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
  mapToSchema: async (ad) => {
    try {
      if (!ad.title || ad.title.trim().length === 0) {
        return fail(new Error("Skipped ad: empty title (likely stopped)"));
      }
      return ok(mapNavAdToJobPosting(ad));
    } catch (error) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
};

// ─── Legacy thin wrapper for backward compatibility ──────────────────────────

export async function harvestNorwegianJobs(
  limit = 50,
): Promise<UnifiedHarvestResult & { discovered: number; active: number }> {
  const result = await executeHarvestPipeline(norwayHarvester, {
    limit,
    lookbackMinutes: 1440,
  });

  if (result.success) {
    return {
      ...result.value,
      discovered: result.value.fetched, // approximation
      active: result.value.mapped,
    };
  }
  throw result.error;
}
