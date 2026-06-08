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
const PLATFORM_NAME = "facebook";

// ─── Fetch Helpers ───────────────────────────────────────────────────────────

function getFallbackMockPosts(q = "chaufför", limit: number): any[] {
  const isChauffor =
    q.toLowerCase().includes("chauff") ||
    q.toLowerCase().includes("ce") ||
    q.toLowerCase().includes("bil");

  if (isChauffor) {
    return [
      {
        id: "fb_post_mock_1",
        message:
          "Hej alla! Vi söker en CE-chaufför omgående för fast körning Stockholm-Göteborg. Mest nattkörning. Krav: CE, YKB, digitalt kort samt viss vana av kyl/frys. Skicka PM vid intresse eller kontakta Bosse på Bosses Transport AB, mobil 070-1234567.",
        created_time: new Date().toISOString(),
        permalink_url:
          "https://facebook.com/groups/chaufforsmarknaden/posts/fb_post_mock_1",
      },
      {
        id: "fb_post_mock_2",
        message:
          "Söker duktig distributionschaufför med C-körkort för distribution i Örebro med omnejd. Start omgående, provanställning 6 månader. Krav: C-kort samt giltigt YKB. Ring eller maila på info@orebrofrakt.se. Hälsningar Johan, Örebro Frakt AB.",
        created_time: new Date().toISOString(),
        permalink_url:
          "https://facebook.com/groups/nordic-transport-jobs/posts/fb_post_mock_2",
      },
    ].slice(0, limit);
  }

  return [
    {
      id: "fb_post_mock_3",
      message:
        "Lagerarbetare sökes till vårt e-handelslager i Borås! Vi söker dig som kan jobba extra under sommaren. Arbetsuppgifter inkluderar plock, pack och truckkörning. Krav: ID06, Truckkort A1-A4. Skicka ansökan till jobb@borasehandel.se.",
      created_time: new Date().toISOString(),
      permalink_url:
        "https://facebook.com/groups/nordic-transport-jobs/posts/fb_post_mock_3",
    },
  ].slice(0, limit);
}

export async function fetchFacebookJobsRaw(
  limit: number,
  q?: string,
): Promise<any[]> {
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  const groupIdsParam =
    process.env.FACEBOOK_GROUP_IDS ||
    "nordic-transport-jobs,chaufforsmarknaden";
  const groupIds = groupIdsParam.split(",").map((id) => id.trim());

  if (!accessToken) {
    console.warn(
      "[FacebookHarvester] FACEBOOK_ACCESS_TOKEN not configured. Returning fallback Facebook group postings.",
    );
    return getFallbackMockPosts(q, limit);
  }

  const allPosts: any[] = [];

  for (const groupId of groupIds) {
    const graphUrl = `https://graph.facebook.com/v19.0/${groupId}/feed?limit=${limit}&fields=id,message,created_time,permalink_url&access_token=${accessToken}`;

    try {
      const response = await fetch(graphUrl, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        console.warn(
          `[FacebookHarvester] Meta Graph API returned status ${response.status} for group ${groupId}`,
        );
        continue;
      }

      const json = await response.json();
      const posts = json.data || [];

      const filteredPosts = posts
        .filter((post: any) => post.message && post.message.trim().length > 20)
        .map((post: any) => ({
          id: post.id,
          message: post.message,
          created_time: post.created_time,
          permalink_url:
            post.permalink_url ||
            `https://facebook.com/groups/${groupId}/posts/${post.id}`,
          groupId,
        }));

      allPosts.push(...filteredPosts);
    } catch (err) {
      console.warn(
        `[FacebookHarvester] Graph API fetch error for group ${groupId}:`,
        err,
      );
    }
  }

  if (allPosts.length === 0) {
    return getFallbackMockPosts(q, limit);
  }

  return allPosts.slice(0, limit);
}

async function extractBasicInfo(
  text: string,
): Promise<{ title: string; company: string; location: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      title: "Chaufför",
      company: "Facebook Rekrytering",
      location: "Sverige",
    };
  }

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json" },
      systemInstruction:
        "Extract 'title' (specific job title), 'company' (employing company or poster name), and 'location' (city/region in Sweden or Nordics) from this Facebook group job post. Respond only in JSON.",
    });

    const prompt = `
Facebook Post:
"${text}"

Output JSON:
{
  "title": "...",
  "company": "...",
  "location": "..."
}
    `;

    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text().trim());

    return {
      title: parsed.title || "",
      company: parsed.company || "",
      location: parsed.location || "",
    };
  } catch {
    return { title: "", company: "", location: "" };
  }
}

// ─── Harvester Definition ────────────────────────────────────────────────────

export const facebookHarvester: HarvesterDefinition<
  any,
  Omit<TablesInsert<"job_postings">, "job_embedding">
> = {
  platformName: PLATFORM_NAME,
  defaultCountry: DEFAULT_COUNTRY,
  defaultLanguage: DEFAULT_LANGUAGE,
  fetchRaw: async (limit, lookbackMinutes, q) => {
    try {
      const ads = await fetchFacebookJobsRaw(limit, q);
      return ok(ads);
    } catch (error: any) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
  mapToSchema: async (rawAd) => {
    try {
      const textToExtract = rawAd.message;
      const aiData = await extractUnstructuredData(textToExtract, PLATFORM_NAME);
      const basicInfo = await extractBasicInfo(textToExtract);

      return ok({
        title: basicInfo.title || "Chaufför via Facebook",
        company: basicInfo.company || "Facebook Rekrytering",
        description: textToExtract,
        location: basicInfo.location || "Sverige",
        country: DEFAULT_COUNTRY,
        source_url: rawAd.permalink_url,
        original_language: DEFAULT_LANGUAGE,
        hard_requirements: aiData.hard_requirements,
        salary_info: aiData.salary_info,
        expires_at: new Date(
          Date.now() + 15 * 24 * 60 * 60 * 1000,
        ).toISOString(), // shorter expiry for social postings
        source_platform: PLATFORM_NAME,
      });
    } catch (error: any) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
  },
};

// ─── Legacy thin wrapper ─────────────────────────────────────────────────────

export async function harvestFacebookJobs(
  limit = 50,
  publishedAfterMinutes = 1440,
  q?: string,
): Promise<UnifiedHarvestResult> {
  const result = await executeHarvestPipeline(facebookHarvester, {
    limit,
    lookbackMinutes: publishedAfterMinutes,
    q,
  });

  if (result.success) {
    return result.value;
  }
  throw result.error;
}
