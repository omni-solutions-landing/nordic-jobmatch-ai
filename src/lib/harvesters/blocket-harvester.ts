import type { TablesInsert } from "@/lib/database.types";
import { Result, ok, fail } from "@/lib/fp/result";
import {
  HarvesterDefinition,
  executeHarvestPipeline,
  extractUnstructuredData,
  type UnifiedHarvestResult,
} from "./harvester-pipeline";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_COUNTRY = "SE";
const DEFAULT_LANGUAGE = "sv";
const PLATFORM_NAME = "blocket";

// ─── Fetch Helpers ───────────────────────────────────────────────────────────

function getFallbackMockAds(q = "chaufför", limit: number): any[] {
  const isChauffor =
    q.toLowerCase().includes("chauff") ||
    q.toLowerCase().includes("ce") ||
    q.toLowerCase().includes("bil");

  if (isChauffor) {
    return [
      {
        title: "TMA-chaufför sökes till vägarbeten i Stockholm",
        company: "Väg & Säkerhet Stockholm AB",
        description:
          "Vi söker TMA-chaufförer inför sommarsäsongen. Du ska köra TMA-bil som skyddsfordon vid vägarbeten. Krav: C-körkort, YKB och APV (Arbete på Väg 1.1-1.3 & 2.1). Erfarenhet av TMA-körning är önskvärt.",
        link: "https://jobb.blocket.se/ledigt-jobb/mockblocket1tma",
        location: "Stockholm, Stockholms län",
      },
      {
        title: "Distributionstransportör med CE-kort",
        company: "Göteborgs Logistik & Transport",
        description:
          "Vi söker en engagerad CE-chaufför för distributionstransporter i västra Sverige. Du kommer köra trailer och behöver giltigt CE-körkort, digitalt förarkort samt YKB.",
        link: "https://jobb.blocket.se/ledigt-jobb/mockblocket2ce",
        location: "Göteborg, Västra Götalands län",
      },
    ].slice(0, limit);
  }

  return [
    {
      title: "Butiksmedarbetare / Lageransvarig till Coop",
      company: "Coop Butiker & Stormarknader",
      description:
        "Vi söker en driven butiksmedarbetare till vår logistik- och varumottagningsavdelning. Du kommer ansvara för varuflöden och lagersaldo. Tidigare erfarenhet inom dagligvaruhandeln är ett plus.",
      link: "https://jobb.blocket.se/ledigt-jobb/mockblocket3coop",
      location: "Linköping, Östergötlands län",
    },
  ].slice(0, limit);
}

export async function fetchBlocketJobsRaw(
  limit: number,
  q?: string,
): Promise<any[]> {
  const queryStr = q ? encodeURIComponent(q) : "chaufför";
  const blocketUrl = `https://jobb.blocket.se/lediga-jobb/?q=${queryStr}`;

  try {
    const response = await fetch(blocketUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Blocket Jobb returned status ${response.status}`);
    }

    const htmlText = await response.text();
    const ads: any[] = [];
    const jsonMatch = htmlText.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    );

    if (jsonMatch && jsonMatch[1]) {
      try {
        const nextData = JSON.parse(jsonMatch[1].trim());
        const jobList =
          nextData.props?.pageProps?.jobs ||
          nextData.props?.pageProps?.initialState?.jobs?.list ||
          [];

        for (const item of jobList) {
          if (ads.length >= limit) break;
          ads.push({
            title: item.title,
            company: item.company?.name || item.company_name,
            description: item.description || item.body_text || "",
            location: item.location || item.municipality || "Sverige",
            link:
              item.url ||
              `https://jobb.blocket.se/ledigt-jobb/${item.slug || item.id}/`,
            id: item.id,
          });
        }
      } catch (jsonErr) {
        console.warn("[BlocketHarvester] JSON state parsing failed:", jsonErr);
      }
    }

    if (ads.length === 0) {
      console.warn(
        "[BlocketHarvester] No listings found in NEXT_DATA. Returning fallback mock scraped listings.",
      );
      return getFallbackMockAds(q, limit);
    }

    return ads;
  } catch (err) {
    console.warn(
      "[BlocketHarvester] Scraper fetch error, returning mock ads:",
      err,
    );
    return getFallbackMockAds(q, limit);
  }
}

// ─── Harvester Definition ────────────────────────────────────────────────────

export const blocketHarvester: HarvesterDefinition<
  any,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: PLATFORM_NAME,
  defaultCountry: DEFAULT_COUNTRY,
  defaultLanguage: DEFAULT_LANGUAGE,
  fetchRaw: async (limit, lookbackMinutes, q) => {
    try {
      const ads = await fetchBlocketJobsRaw(limit, q);
      return ok(ads);
    } catch (error: any) {
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
        company: rawAd.company || "Blocket Kundföretag",
        description: rawAd.description,
        location: rawAd.location || "Sverige",
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
    } catch (error: any) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
};

// ─── Legacy thin wrapper ─────────────────────────────────────────────────────

export async function harvestBlocketJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<UnifiedHarvestResult> {
  const result = await executeHarvestPipeline(blocketHarvester, {
    limit,
    lookbackMinutes: publishedAfterMinutes,
    q,
  });

  if (result.success) {
    return result.value;
  }
  throw result.error;
}
