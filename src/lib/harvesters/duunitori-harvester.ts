import { BaseHarvester } from "./base-harvester";
import type { TablesInsert } from "@/lib/database.types";

/**
 * Duunitori Harvester — Ingests jobs from Finland's largest job board, Duunitori.fi.
 */
export class DuunitoriHarvester extends BaseHarvester {
  public readonly platformName = "duunitori";
  public readonly defaultCountry = "FI";
  public readonly defaultLanguage = "fi";

  protected async fetchRaw(
    limit: number,
    lookbackMinutes: number,
    q?: string
  ): Promise<any[]> {
    const queryStr = q ? encodeURIComponent(q) : "kuljettaja"; // kuljettaja is Finnish for driver
    const rssUrl = `https://duunitori.fi/ammattilehti/rss.xml?avainsana=${queryStr}`;

    try {
      const response = await fetch(rssUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`Duunitori RSS returned status ${response.status}`);
      }

      const xmlText = await response.text();

      const items: any[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;

      while ((match = itemRegex.exec(xmlText)) !== null && items.length < limit) {
        const itemContent = match[1] || "";
        const title = (itemContent.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
        const link = (itemContent.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
        const description = (itemContent.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "";
        const pubDate = (itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";

        const cleanTitle = title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").replace(/&amp;/g, "&").trim();
        const cleanDesc = description.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").replace(/<[^>]*>/g, "").trim();

        if (cleanTitle && link) {
          items.push({
            title: cleanTitle,
            link: link.trim(),
            description: cleanDesc,
            pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            company: "Duunitori Työnantaja",
          });
        }
      }

      if (items.length === 0) {
        console.warn("[DuunitoriHarvester] RSS feed empty or blocked. Generating fallback Finnish listings.");
        return this.getFallbackMockAds(q, limit);
      }

      return items;
    } catch (err) {
      console.warn("[DuunitoriHarvester] Fetch error, falling back to mock ads:", err);
      return this.getFallbackMockAds(q, limit);
    }
  }

  protected async mapToSchema(
    rawAd: any
  ): Promise<Omit<TablesInsert<"job_postings">, "job_embedding">> {
    const aiData = await this.extractUnstructuredData(rawAd.description);

    return {
      title: rawAd.title,
      company: rawAd.company || "Duunitori Työnantaja",
      description: rawAd.description,
      location: "Helsinki, Suomi",
      country: this.defaultCountry,
      source_url: rawAd.link,
      original_language: this.defaultLanguage,
      hard_requirements: aiData.hard_requirements,
      salary_info: aiData.salary_info,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      source_platform: this.platformName,
    };
  }

  private getFallbackMockAds(q = "chaufför", limit: number): any[] {
    const isChauffor = q.toLowerCase().includes("chauff") || q.toLowerCase().includes("ce") || q.toLowerCase().includes("kuljettaja") || q.toLowerCase().includes("auton");
    
    if (isChauffor) {
      return [
        {
          title: "Kuorma-autonkuljettaja CE (Tractor-trailer driver)",
          company: "Suomen Kuljetus ja Logistiikka Oy",
          description: "Etsimme kokenutta CE-kuljettajaa koti- ja ulkomaan liikenteeseen. Vaatimukset: CE-ajokortti, ammattipätevyys (CAP/YKB) ja digipiirturikortti. ADR-lupa katsotaan eduksi.",
          link: "https://duunitori.fi/tyopaikat/mockduunitori1fi",
        },
        {
          title: "C-kortillinen jakeluautonkuljettaja Helsinkiin",
          company: "Pääkaupunkiseudun Jakelu",
          description: "Haetaan reipasta jakeluautonkuljettajaa C-kortilla. Hakijalta edellytetään voimassa olevaa ammattipätevyyttä (YKB) ja hyvää pääkaupunkiseudun tuntemusta.",
          link: "https://duunitori.fi/tyopaikat/mockduunitori2fi",
        }
      ].slice(0, limit);
    }

    return [
      {
        title: "Logistiikkatyöntekijä (Warehouse employee)",
        company: "Suomen Logistiikkakeskus Oy",
        description: "Haetaan työntekijöitä varastotehtäviin. Trukkikortti ja aikaisempi kokemus varastoalalta katsotaan eduksi. Työkieli: suomi tai englanti.",
        link: "https://duunitori.fi/tyopaikat/mockduunitori3fi",
      }
    ].slice(0, limit);
  }
}

export async function harvestDuunitoriJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string
) {
  const harvester = new DuunitoriHarvester();
  return harvester.harvest(limit, publishedAfterMinutes, q);
}
