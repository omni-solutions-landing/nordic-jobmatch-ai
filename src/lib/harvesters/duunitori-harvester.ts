import type { TablesInsert } from "@/lib/database.types";
import { ok, fail } from "@/lib/fp/result";
import {
  HarvesterDefinition,
  executeHarvestPipeline,
  extractUnstructuredData,
  type UnifiedHarvestResult,
} from "./harvester-pipeline";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_COUNTRY = "FI";
const DEFAULT_LANGUAGE = "fi";
const PLATFORM_NAME = "duunitori";

/**
 * Duunitori's public JSON API. The old /ammattilehti/rss.xml feed was removed
 * (404 since at least 2026-06); /api/v1/jobentries is what the site itself
 * uses and returns paginated JSON.
 */
const DUUNITORI_API_URL = "https://duunitori.fi/api/v1/jobentries";
const PAGE_FETCH_LIMIT = 5;

/** Normalized raw ad shape produced by the fetcher (and mock fallbacks). */
interface RawDuunitoriAd {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  company?: string;
  location?: string;
}

/** One job entry as returned by the Duunitori JSON API. */
interface DuunitoriApiJob {
  heading: string;
  date_posted: string;
  slug: string;
  municipality_name: string | null;
  company_name: string | null;
  descr: string;
}

interface DuunitoriApiResponse {
  count: number;
  next: string | null;
  results: DuunitoriApiJob[];
}

// ─── Fetch Helper ────────────────────────────────────────────────────────────

function getFallbackMockAds(q = "chaufför", limit: number): RawDuunitoriAd[] {
  // Mock listings are for local development only. In production a failed
  // fetch must return nothing — never fabricated jobs with dead links.
  if (process.env.ALLOW_MOCK_FALLBACKS !== "true") {
    return [];
  }

  const isChauffor =
    q.toLowerCase().includes("chauff") ||
    q.toLowerCase().includes("ce") ||
    q.toLowerCase().includes("kuljettaja") ||
    q.toLowerCase().includes("auton");

  if (isChauffor) {
    return [
      {
        title: "Kuorma-autonkuljettaja CE (Tractor-trailer driver)",
        company: "Suomen Kuljetus ja Logistiikka Oy",
        description:
          "Etsimme kokenutta CE-kuljettajaa koti- ja ulkomaan liikenteeseen. Vaatimukset: CE-ajokortti, ammattipätevyys (CAP/YKB) ja digipiirturikortti. ADR-lupa katsotaan eduksi.",
        link: "https://duunitori.fi/tyopaikat/mockduunitori1fi",
      },
      {
        title: "C-kortillinen jakeluautonkuljettaja Helsinkiin",
        company: "Pääkaupunkiseudun Jakelu",
        description:
          "Haetaan reipasta jakeluautonkuljettajaa C-kortilla. Hakijalta edellytetään voimassa olevaa ammattipätevyyttä (YKB) ja hyvää pääkaupunkiseudun tuntemusta.",
        link: "https://duunitori.fi/tyopaikat/mockduunitori2fi",
      },
    ].slice(0, limit);
  }

  return [
    {
      title: "Logistiikkatyöntekijä (Warehouse employee)",
      company: "Suomen Logistiikkakeskus Oy",
      description:
        "Haetaan työntekijöitä varastotehtäviin. Trukkikortti ja aikaisempi kokemus varastoalalta katsotaan eduksi. Työkieli: suomi tai englanti.",
      link: "https://duunitori.fi/tyopaikat/mockduunitori3fi",
    },
  ].slice(0, limit);
}

export async function fetchDuunitoriJobsRaw(
  limit: number,
  q?: string,
  lookbackMinutes?: number,
): Promise<RawDuunitoriAd[]> {
  const cutoffMs = lookbackMinutes
    ? Date.now() - lookbackMinutes * 60 * 1000
    : null;

  try {
    const items: RawDuunitoriAd[] = [];
    let url: string | null = `${DUUNITORI_API_URL}?search=${encodeURIComponent(
      q || "kuljettaja",
    )}`;

    for (let page = 0; url && items.length < limit && page < PAGE_FETCH_LIMIT; page++) {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`Duunitori API returned status ${response.status}`);
      }

      const data: DuunitoriApiResponse = await response.json();

      for (const job of data.results) {
        if (items.length >= limit) break;
        if (!job.heading || !job.slug) continue;
        if (cutoffMs && job.date_posted) {
          const postedMs = Date.parse(job.date_posted);
          if (!Number.isNaN(postedMs) && postedMs < cutoffMs) continue;
        }
        items.push({
          title: job.heading,
          link: `https://duunitori.fi/tyopaikat/tyo/${job.slug}`,
          description: job.descr || job.heading,
          pubDate: job.date_posted
            ? new Date(job.date_posted).toISOString()
            : new Date().toISOString(),
          company: job.company_name || "Duunitori Työnantaja",
          location: job.municipality_name || undefined,
        });
      }

      url = data.next;
    }

    if (items.length === 0) {
      console.warn(
        "[DuunitoriHarvester] API returned no entries within lookback window. Falling back (mocks only if ALLOW_MOCK_FALLBACKS=true).",
      );
      return getFallbackMockAds(q, limit);
    }

    return items;
  } catch (err) {
    console.warn(
      "[DuunitoriHarvester] Fetch error. Falling back (mocks only if ALLOW_MOCK_FALLBACKS=true):",
      err,
    );
    return getFallbackMockAds(q, limit);
  }
}

// ─── Harvester Definition ────────────────────────────────────────────────────

export const duunitoriHarvester: HarvesterDefinition<
  RawDuunitoriAd,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: PLATFORM_NAME,
  defaultCountry: DEFAULT_COUNTRY,
  defaultLanguage: DEFAULT_LANGUAGE,
  fetchRaw: async (limit, lookbackMinutes, q) => {
    try {
      const ads = await fetchDuunitoriJobsRaw(limit, q, lookbackMinutes);
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
      return ok({
        title: rawAd.title,
        company: rawAd.company || "Duunitori Työnantaja",
        description: rawAd.description,
        location: rawAd.location || "Suomi",
        country: DEFAULT_COUNTRY,
        source_url: rawAd.link,
        original_language: DEFAULT_LANGUAGE,
        hard_requirements: aiData.hard_requirements,
        salary_info: aiData.salary_info,
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

export async function harvestDuunitoriJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<UnifiedHarvestResult> {
  const result = await executeHarvestPipeline(duunitoriHarvester, {
    limit,
    lookbackMinutes: publishedAfterMinutes,
    q,
  });

  if (result.success) {
    return result.value;
  }
  throw result.error;
}
