/**
 * Sweden Harvester — JobTech Dev (Platsbanken) Integration
 *
 * Fetches job postings from Sweden's public employment service API,
 * normalizes them to our schema, generates embeddings, and stores
 * them in Supabase.
 *
 * API docs: https://jobsearch.api.jobtechdev.se
 * License: Ads are CC0 (public domain)
 *
 * @module Harvester — runs server-side only.
 */

import type { TablesInsert } from "@/lib/database.types";
import { Result, ok, fail } from "@/lib/fp/result";
import {
  HarvesterDefinition,
  executeHarvestPipeline,
  type UnifiedHarvestResult,
} from "./harvester-pipeline";

// ─── Configuration ───────────────────────────────────────────────────────────

const JOBTECH_BASE_URL = "https://jobsearch.api.jobtechdev.se";
const API_MAX_LIMIT = 100;
const API_MAX_OFFSET = 2000;
const INTER_PAGE_DELAY_MS = 500;
const USER_AGENT = "NordicJobMatchAI/1.0 (github.com/nordic-jobmatch-ai)";

// ─── JobTech API Response Types ──────────────────────────────────────────────

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

export interface JobTechAd {
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

interface JobTechSearchResponse {
  total: { value: number };
  positions: number;
  query_time_in_millis: number;
  result_time_in_millis: number;
  hits: JobTechAd[];
}

// ─── API Client ──────────────────────────────────────────────────────────────

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

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(2000 * 2 ** attempt, 16000);

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error(`Rate limited by JobTech API after ${maxRetries} retries`);
      }

      if (!response.ok) {
        throw new Error(`JobTech API returned ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as JobTechSearchResponse;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
    }
  }

  throw new Error(`JobTech API request failed after ${maxRetries} retries: ${lastError?.message}`);
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchSwedishJobs(
  limit: number,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<Result<JobTechAd[]>> {
  try {
    const allAds: JobTechAd[] = [];
    const effectiveLimit = Math.min(limit, API_MAX_OFFSET + API_MAX_LIMIT);
    let offset = 0;
    let totalAvailable = 0;

    while (allAds.length < effectiveLimit) {
      const pageSize = Math.min(
        API_MAX_LIMIT,
        effectiveLimit - allAds.length,
      );

      const apiParams: Record<string, string> = {
        limit: String(pageSize),
        offset: String(offset),
        sort: "pubdate-desc",
        "published-after": String(publishedAfterMinutes),
      };

      if (q && q.trim()) {
        apiParams.q = q.trim();
      }

      const response = await callJobTechApi(apiParams);

      totalAvailable = response.total.value;
      if (response.hits.length === 0) break;

      const activeAds = response.hits.filter((ad) => !ad.removed);
      allAds.push(...activeAds);

      offset += response.hits.length;
      if (offset >= totalAvailable || offset >= API_MAX_OFFSET) break;

      if (allAds.length < effectiveLimit) {
        await new Promise((r) => setTimeout(r, INTER_PAGE_DELAY_MS));
      }
    }

    return ok(allAds.slice(0, limit));
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}

// ─── Mapper Helpers ──────────────────────────────────────────────────────────

function buildLocationString(addr: JobTechAddress | null): string {
  if (!addr) return "Sverige";
  const parts = [addr.municipality, addr.region].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : "Sverige";
}

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

  if (ad.driving_license_required) {
    if (ad.driving_license && ad.driving_license.length > 0) {
      const classes = ad.driving_license.map((d) => d.label).join(", ");
      reqs.push(`Körkort ${classes}`);
    } else {
      reqs.push("Körkort (driver license)");
    }
  }

  return [...new Set(reqs)];
}

function buildSalaryInfo(ad: JobTechAd): Record<string, string> {
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

// ─── Harvester Definition ────────────────────────────────────────────────────

export const swedenHarvester: HarvesterDefinition<
  JobTechAd,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: "platsbanken",
  defaultCountry: "SE",
  defaultLanguage: "sv",
  fetchRaw: (limit, lookbackMinutes, q) =>
    fetchSwedishJobs(limit, lookbackMinutes, q),
  mapToSchema: async (ad) => {
    try {
      return ok(mapJobTechAdToJobPosting(ad));
    } catch (error) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
};

// ─── Legacy thin wrapper for backward compatibility ──────────────────────────

export async function harvestSwedishJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<UnifiedHarvestResult> {
  const result = await executeHarvestPipeline(swedenHarvester, {
    limit,
    lookbackMinutes: publishedAfterMinutes,
    q,
  });

  if (result.success) {
    return result.value;
  }
  throw result.error;
}
