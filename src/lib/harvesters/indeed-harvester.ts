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
const PLATFORM_NAME = "indeed";

// ─── Fetch Helper ────────────────────────────────────────────────────────────

function getFallbackMockAds(q = "chaufför", limit: number): any[] {
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
        title: "Erfaren CE-chaufför sökes till fjärrtransporter",
        company: "Nordic Road Cargo AB",
        description:
          "Vi söker nu en engagerad och pålitlig CE-chaufför för fjärrtransporter inom Sverige och Norge. Krav: CE-körkort, YKB och digitalt förarkort. ADR är starkt meriterande. Lön enligt kollektivavtal.",
        link: "https://se.indeed.com/viewjob?jk=mockindeed1ce",
      },
      {
        title: "Lastbilschaufför klass C för lokal distribution",
        company: "DHL Express Delivery",
        description:
          "Vi söker C-chaufförer för dagliga turer i Stockholmsområdet. Du har C-körkort, giltigt YKB och god samarbetsförmåga. Erfarenhet av liknande arbete krävs.",
        link: "https://se.indeed.com/viewjob?jk=mockindeed2c",
      },
    ].slice(0, limit);
  }

  return [
    {
      title: "Logistikkoordinator / Transportplanerare",
      company: "Schenker Logistics",
      description:
        "Vill du arbeta med planering och koordinering av transporter? Vi söker en transportplanerare med erfarenhet av logistiksystem och flytande svenska och engelska.",
      link: "https://se.indeed.com/viewjob?jk=mockindeed3log",
    },
  ].slice(0, limit);
}

export async function fetchIndeedJobsRaw(
  limit: number,
  q?: string,
): Promise<any[]> {
  const queryStr = q ? encodeURIComponent(q) : "chaufför";
  const rssUrl = `https://se.indeed.com/rss?q=${queryStr}&limit=${limit}`;

  try {
    const response = await fetch(rssUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Indeed RSS returned status ${response.status}`);
    }

    const xmlText = await response.text();
    const items: any[] = [];
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
      const source =
        (itemContent.match(/<source>([\s\S]*?)<\/source>/) || [])[1] || "";

      const cleanTitle = title
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")
        .replace(/&amp;/g, "&")
        .trim();
      const cleanDesc = description
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")
        .replace(/<[^>]*>/g, "")
        .trim();

      if (cleanTitle && link) {
        items.push({
          title: cleanTitle,
          link: link.trim(),
          description: cleanDesc,
          pubDate: pubDate
            ? new Date(pubDate).toISOString()
            : new Date().toISOString(),
          company: source.trim() || "Indeed Client",
        });
      }
    }

    if (items.length === 0) {
      console.warn(
        "[IndeedHarvester] RSS feed empty or blocked. Falling back (mocks only if ALLOW_MOCK_FALLBACKS=true).",
      );
      return getFallbackMockAds(q, limit);
    }

    return items;
  } catch (err) {
    console.warn(
      "[IndeedHarvester] Fetch error. Falling back (mocks only if ALLOW_MOCK_FALLBACKS=true):",
      err,
    );
    return getFallbackMockAds(q, limit);
  }
}

// ─── Harvester Definition ────────────────────────────────────────────────────

export const indeedHarvester: HarvesterDefinition<
  any,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: PLATFORM_NAME,
  defaultCountry: DEFAULT_COUNTRY,
  defaultLanguage: DEFAULT_LANGUAGE,
  fetchRaw: async (limit, lookbackMinutes, q) => {
    try {
      const ads = await fetchIndeedJobsRaw(limit, q);
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
        company: rawAd.company || "Indeed Client",
        description: rawAd.description,
        location: "Stockholm, Sverige",
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

export async function harvestIndeedJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<UnifiedHarvestResult> {
  const result = await executeHarvestPipeline(indeedHarvester, {
    limit,
    lookbackMinutes: publishedAfterMinutes,
    q,
  });

  if (result.success) {
    return result.value;
  }
  throw result.error;
}
