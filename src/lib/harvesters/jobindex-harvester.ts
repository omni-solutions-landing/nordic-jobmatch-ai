import type { TablesInsert } from "@/lib/database.types";
import { ok, fail } from "@/lib/fp/result";
import {
  HarvesterDefinition,
  executeHarvestPipeline,
  extractUnstructuredData,
  type UnifiedHarvestResult,
} from "./harvester-pipeline";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_COUNTRY = "DK";
const DEFAULT_LANGUAGE = "da";
const PLATFORM_NAME = "jobindex";

/** Raw RSS item shape produced by the fetcher (and mock fallbacks). */
interface RawRssAd {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  company?: string;
}

// ─── Fetch Helper ────────────────────────────────────────────────────────────

function getFallbackMockAds(q = "chauffør", limit: number): RawRssAd[] {
  // Mock listings are for local development only. In production a failed
  // fetch must return nothing — never fabricated jobs with dead links.
  if (process.env.ALLOW_MOCK_FALLBACKS !== "true") {
    return [];
  }

  const isChauffor =
    q.toLowerCase().includes("chauff") ||
    q.toLowerCase().includes("ce") ||
    q.toLowerCase().includes("bil");

  if (isChauffor) {
    return [
      {
        title: "Lastbilschauffør CE søges til kørsel i Danmark og Sverige",
        company: "Dansk Transport Logistik ApS",
        description:
          "Søger erfarne CE chauffører til kørsel med trækker/trailer. Krav: Gyldigt CE-kørekort, EU-kvalifikationsbevis (EU-efteruddannelse/YKB) og førerkort. Skal kunne tale skandinavisk eller engelsk.",
        link: "https://www.jobindex.dk/job/mockjobindex1dk",
      },
      {
        title: "Chauffør til distributionskørsel (Klasse C)",
        company: "København Varedistribution",
        description:
          "Vi søger en chauffør med C-kørekort til distribution af varer i Storkøbenhavn. Du skal have gyldigt EU-bevis og digitalt førerkort.",
        link: "https://www.jobindex.dk/job/mockjobindex2dk",
      },
    ].slice(0, limit);
  }

  return [
    {
      title: "Lager- og logistikmedarbejder",
      company: "ScanCargo A/S",
      description:
        "Søger en medarbejder til plukning, pakning og lagerstyring. Truckcertifikat er et krav. Erfaring med lager-it er en fordel.",
      link: "https://www.jobindex.dk/job/mockjobindex3dk",
    },
  ].slice(0, limit);
}

/** Decodes numeric character references and the basic named XML entities. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export async function fetchJobindexJobsRaw(
  limit: number,
  q?: string,
): Promise<RawRssAd[]> {
  const queryStr = q ? encodeURIComponent(q) : "chauffør";
  const rssUrl = `https://www.jobindex.dk/jobsoegning?q=${queryStr}&format=rss`;

  try {
    const response = await fetch(rssUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Jobindex RSS returned status ${response.status}`);
    }

    // Jobindex serves the RSS as ISO-8859-1 (declared in the XML prolog);
    // response.text() would decode it as UTF-8 and garble æ/ø/å.
    const rawBytes = await response.arrayBuffer();
    const sniff = new TextDecoder("utf-8").decode(rawBytes.slice(0, 200));
    const charsetMatch = sniff.match(/encoding="([^"]+)"/i);
    const xmlText = new TextDecoder(
      charsetMatch?.[1]?.toLowerCase() ?? "utf-8",
    ).decode(rawBytes);
    const items: RawRssAd[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null && items.length < limit) {
      const itemContent = match[1] || "";
      const title =
        (itemContent.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
      const link =
        (itemContent.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
      const description =
        (itemContent.match(/<description>([\s\S]*?)<\/description>/) || [])[1] ||
        "";
      const pubDate =
        (itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";

      const cleanTitle = decodeXmlEntities(
        title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1"),
      ).trim();
      const cleanDesc = decodeXmlEntities(
        description
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")
          .replace(/<[^>]*>/g, ""),
      ).trim();

      if (cleanTitle && link) {
        items.push({
          title: cleanTitle,
          link: link.trim(),
          description: cleanDesc,
          pubDate: pubDate
            ? new Date(pubDate).toISOString()
            : new Date().toISOString(),
          company: "Jobindex Virksomhed",
        });
      }
    }

    if (items.length === 0) {
      console.warn(
        "[JobindexHarvester] RSS feed empty or blocked. Falling back (mocks only if ALLOW_MOCK_FALLBACKS=true).",
      );
      return getFallbackMockAds(q, limit);
    }

    return items;
  } catch (err) {
    console.warn(
      "[JobindexHarvester] Fetch error. Falling back (mocks only if ALLOW_MOCK_FALLBACKS=true):",
      err,
    );
    return getFallbackMockAds(q, limit);
  }
}

// ─── Harvester Definition ────────────────────────────────────────────────────

export const jobindexHarvester: HarvesterDefinition<
  RawRssAd,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: PLATFORM_NAME,
  defaultCountry: DEFAULT_COUNTRY,
  defaultLanguage: DEFAULT_LANGUAGE,
  fetchRaw: async (limit, lookbackMinutes, q) => {
    try {
      const ads = await fetchJobindexJobsRaw(limit, q);
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
        company: rawAd.company || "Jobindex Virksomhed",
        description: rawAd.description,
        location: "København, Danmark",
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

export async function harvestJobindexJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<UnifiedHarvestResult> {
  const result = await executeHarvestPipeline(jobindexHarvester, {
    limit,
    lookbackMinutes: publishedAfterMinutes,
    q,
  });

  if (result.success) {
    return result.value;
  }
  throw result.error;
}
