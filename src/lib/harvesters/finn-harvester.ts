import type { TablesInsert } from "@/lib/database.types";
import { ok, fail } from "@/lib/fp/result";
import {
  HarvesterDefinition,
  executeHarvestPipeline,
  extractUnstructuredData,
  type UnifiedHarvestResult,
} from "./harvester-pipeline";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_COUNTRY = "NO";
const DEFAULT_LANGUAGE = "no";
const PLATFORM_NAME = "finn";

/** Raw job shape parsed from FINN.no JSON-LD (and mock fallbacks). */
interface RawFinnAd {
  title: string;
  company?: string;
  description: string;
  location?: string;
  link: string;
}

// ─── Fetch Helpers ───────────────────────────────────────────────────────────

function getFallbackMockAds(q = "sjåfør", limit: number): RawFinnAd[] {
  // Mock listings are for local development only. In production a failed
  // fetch must return nothing — never fabricated jobs with dead links.
  if (process.env.ALLOW_MOCK_FALLBACKS !== "true") {
    return [];
  }

  const isChauffor =
    q.toLowerCase().includes("sjåfør") ||
    q.toLowerCase().includes("chauff") ||
    q.toLowerCase().includes("ce") ||
    q.toLowerCase().includes("lastebil");

  if (isChauffor) {
    return [
      {
        title: "Kranbilsjåfør klasse G8 / CE søkes",
        company: "Oslo Kranbil og Transport AS",
        description:
          "Vi søker en erfaren kranbilsjåfør med førerkort klasse CE og kranførerbevis G8. Du vil utføre varierte løfteoppdrag i Oslo og Akershus. Gode lønnsbetingelser for rett person. Krav: CE, YKB, G8 kranbevis.",
        link: "https://www.finn.no/job/fulltime/ad.html?finnkod=mockfinn1",
        location: "Oslo, Norge",
      },
      {
        title: "Lastebilsjåfør klasse CE til langtransport",
        company: "Norsk Logistikkpartner AS",
        description:
          "Vi har økende oppdragsmengde og søker en langtransportsjåfør for ruter mellom Oslo, Bergen och Trondheim. Krav: Førerkort klasse CE, YKB (yrkeskompetansebevis), og digitalt sjåførkort.",
        link: "https://www.finn.no/job/fulltime/ad.html?finnkod=mockfinn2",
        location: "Bergen, Norge",
      },
      {
        title: "Distribusjonssjåfør klasse C i Vestfold",
        company: "Tønsberg Varedistribusjon",
        description:
          "Vi søker en pålitelig distribusjonssjåfør med klasse C. Du har YKB och snakker skandinavisk. Arbeidet består av distribusjon av stykkgods til faste kunder.",
        link: "https://www.finn.no/job/fulltime/ad.html?finnkod=mockfinn3",
        location: "Tønsberg, Norge",
      },
    ].slice(0, limit);
  }

  return [
    {
      title: "Lagermedarbeider med truckførerbevis",
      company: "Viken Logistikksenter AS",
      description:
        "Vi søker lagermedarbeidere til vårt terminalbygg. Truckførerbevis T1-T4 er påkrevd. Erfaring med kjøring av motvektstruck och skyvemasttruck er en fordel.",
      link: "https://www.finn.no/job/fulltime/ad.html?finnkod=mockfinn4",
      location: "Drammen, Norge",
    },
  ].slice(0, limit);
}

export async function fetchFinnJobsRaw(
  limit: number,
  q?: string,
): Promise<RawFinnAd[]> {
  const queryStr = q ? encodeURIComponent(q) : "sjåfør";
  const finnUrl = `https://www.finn.no/job/fulltime/search.html?q=${queryStr}`;

  try {
    const response = await fetch(finnUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "no,en-US;q=0.7,en;q=0.3",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`FINN.no returned status ${response.status}`);
    }

    const html = await response.text();
    const ads: RawFinnAd[] = [];
    const jsonLdMatches = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    );

    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const cleanJson = match
            .replace(/<script type="application\/ld\+json">/, "")
            .replace(/<\/script>/, "")
            .trim();
          const data = JSON.parse(cleanJson);

          if (data["@type"] === "JobPosting") {
            ads.push({
              title: data.title,
              company: data.hiringOrganization?.name || "FINN Arbeidsgiver",
              description: data.description || "",
              location: data.jobLocation?.address?.addressLocality || "Norge",
              link: data.url || finnUrl,
            });
          } else if (data["@graph"]) {
            for (const graphItem of data["@graph"]) {
              if (graphItem["@type"] === "JobPosting") {
                ads.push({
                  title: graphItem.title,
                  company:
                    graphItem.hiringOrganization?.name || "FINN Arbeidsgiver",
                  description: graphItem.description || "",
                  location:
                    graphItem.jobLocation?.address?.addressLocality || "Norge",
                  link: graphItem.url || finnUrl,
                });
              }
            }
          }
        } catch {
          // Ignore individual parsing issues
        }
      }
    }

    if (ads.length === 0) {
      console.warn(
        "[FinnHarvester] No listings scraped from HTML. Falling back (mocks only if ALLOW_MOCK_FALLBACKS=true).",
      );
      return getFallbackMockAds(q, limit);
    }

    return ads.slice(0, limit);
  } catch (err) {
    console.warn(
      "[FinnHarvester] Scraper fetch error. Falling back (mocks only if ALLOW_MOCK_FALLBACKS=true):",
      err,
    );
    return getFallbackMockAds(q, limit);
  }
}

// ─── Harvester Definition ────────────────────────────────────────────────────

export const finnHarvester: HarvesterDefinition<
  RawFinnAd,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: PLATFORM_NAME,
  defaultCountry: DEFAULT_COUNTRY,
  defaultLanguage: DEFAULT_LANGUAGE,
  fetchRaw: async (limit, lookbackMinutes, q) => {
    try {
      const ads = await fetchFinnJobsRaw(limit, q);
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
        company: rawAd.company || "FINN Arbeidsgiver",
        description: rawAd.description,
        location: rawAd.location || "Norge",
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

export async function harvestFinnJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<UnifiedHarvestResult> {
  const result = await executeHarvestPipeline(finnHarvester, {
    limit,
    lookbackMinutes: publishedAfterMinutes,
    q,
  });

  if (result.success) {
    return result.value;
  }
  throw result.error;
}
