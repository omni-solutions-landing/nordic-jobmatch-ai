import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  generateEmbeddingsBatch,
  stringifyJobForEmbedding,
  type RawJobData,
} from "@/lib/ai/embeddings";
import { createServiceClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/database.types";
import { Result, ok, fail } from "@/lib/fp/result";

export interface UnifiedHarvestResult {
  platform: string;
  fetched: number;
  mapped: number;
  stored: number;
  skipped: number;
  errors: string[];
  timing: {
    fetchMs: number;
    embedMs: number;
    storeMs: number;
    totalMs: number;
  };
}

export interface HarvesterDefinition<RawAd, NormalizedAd> {
  readonly platformName: string;
  readonly defaultCountry: "SE" | "NO" | "DK" | "FI";
  readonly defaultLanguage: "sv" | "no" | "da" | "fi" | "en";
  readonly fetchRaw: (limit: number, lookbackMinutes: number, q?: string) => Promise<Result<RawAd[]>>;
  readonly mapToSchema: (rawAd: RawAd) => Promise<Result<NormalizedAd>>;
}

/**
 * Pure helper using Gemini to extract structured hard requirements and salary info from raw unstructured text.
 */
export async function extractUnstructuredData(
  text: string,
  platformName: string
): Promise<{ hard_requirements: string[]; salary_info: Record<string, any> }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { hard_requirements: [], salary_info: {} };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json" },
      systemInstruction:
        "You are an AI recruitment parser. Analyze the unstructured job posting description. Extract any explicit/formal qualifications, certifications (e.g. driver license class like B, C, CE, YKB, ADR, education level, language requirements) into 'hard_requirements' string array. Extract any salary ranges or details into 'salary_info' object (fields like currency, period, min, max). Respond only with valid JSON.",
    });

    const prompt = `
Job Ad Description:
${text}

Extract structured requirements and salary details. Output structure:
{
  "hard_requirements": ["Requirement 1", "Requirement 2"],
  "salary_info": {
    "currency": "SEK|NOK|EUR",
    "min": 30000,
    "max": 40000,
    "period": "monthly|yearly|hourly"
  }
}
    `;

    const result = await model.generateContent(prompt);
    const resText = result.response.text().trim();
    const parsed = JSON.parse(resText);

    return {
      hard_requirements: Array.isArray(parsed.hard_requirements) ? parsed.hard_requirements : [],
      salary_info: parsed.salary_info && typeof parsed.salary_info === "object" ? parsed.salary_info : {},
    };
  } catch (err) {
    console.warn(`[harvester-pipeline] Gemini extraction failed for ${platformName}:`, err);
    return { hard_requirements: [], salary_info: {} };
  }
}

/**
 * Pure functional harvester pipeline executor.
 * Takes a harvester definition and executes the pipeline: Ingest -> Map -> Embed -> Store.
 */
export async function executeHarvestPipeline<Raw, Norm extends Omit<TablesInsert<"job_postings">, "job_embedding">>(
  definition: HarvesterDefinition<Raw, Norm>,
  options: { limit: number; lookbackMinutes: number; q?: string }
): Promise<Result<UnifiedHarvestResult>> {
  const totalStart = performance.now();
  const errors: string[] = [];

  // 1. Fetch Raw Ads
  const fetchStart = performance.now();
  const rawAdsResult = await definition.fetchRaw(options.limit, options.lookbackMinutes, options.q);
  const fetchMs = Math.round(performance.now() - fetchStart);

  if (!rawAdsResult.success) {
    return fail(new Error(`[${definition.platformName}] Fetch failed: ${rawAdsResult.error.message}`));
  }

  const rawAds = rawAdsResult.value;
  if (rawAds.length === 0) {
    return ok({
      platform: definition.platformName,
      fetched: 0,
      mapped: 0,
      stored: 0,
      skipped: 0,
      errors: [],
      timing: { fetchMs, embedMs: 0, storeMs: 0, totalMs: Math.round(performance.now() - totalStart) }
    });
  }

  // 2. Map to Unified Schema
  const mappedJobs: {
    row: Norm;
    originalTitle: string;
  }[] = [];

  for (const ad of rawAds) {
    const mapResult = await definition.mapToSchema(ad);
    if (mapResult.success) {
      const row = mapResult.value;
      // Force correct source_platform in case harvester function does not set it
      row.source_platform = definition.platformName;
      mappedJobs.push({ row, originalTitle: row.title ?? "" });
    } else {
      errors.push(`Mapping error for ad: ${mapResult.error.message}`);
    }
  }

  if (mappedJobs.length === 0) {
    return ok({
      platform: definition.platformName,
      fetched: rawAds.length,
      mapped: 0,
      stored: 0,
      skipped: rawAds.length,
      errors,
      timing: { fetchMs, embedMs: 0, storeMs: 0, totalMs: Math.round(performance.now() - totalStart) }
    });
  }

  // 3. Generate Embeddings (batch)
  const embedStart = performance.now();
  const rawJobDataList: RawJobData[] = mappedJobs.map(({ row, originalTitle }) => ({
    title: row.title ?? "",
    company: row.company ?? undefined,
    description: row.description ?? "",
    location: row.location ?? undefined,
    country: row.country,
    hard_requirements: row.hard_requirements ?? [],
    salary_info: row.salary_info as RawJobData["salary_info"],
    original_title: originalTitle !== row.title ? originalTitle : undefined,
  }));

  const embeddingTexts = rawJobDataList.map((j) => stringifyJobForEmbedding(j));
  const allEmbeddings: number[][] = [];

  try {
    const BATCH_SIZE = 20;
    for (let i = 0; i < embeddingTexts.length; i += BATCH_SIZE) {
      const chunk = embeddingTexts.slice(i, i + BATCH_SIZE);
      const chunkEmbeddings = await generateEmbeddingsBatch(chunk, {
        taskType: "document",
      });
      allEmbeddings.push(...chunkEmbeddings);

      if (i + BATCH_SIZE < embeddingTexts.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  } catch (err: any) {
    console.error(`[harvester-pipeline] Embedding generation failed for ${definition.platformName}:`, err);
    return ok({
      platform: definition.platformName,
      fetched: rawAds.length,
      mapped: mappedJobs.length,
      stored: 0,
      skipped: rawAds.length,
      errors: [...errors, `Embedding error: ${err.message}`],
      timing: { fetchMs, embedMs: Math.round(performance.now() - embedStart), storeMs: 0, totalMs: Math.round(performance.now() - totalStart) }
    });
  }
  const embedMs = Math.round(performance.now() - embedStart);

  // 4. Store in Supabase
  const storeStart = performance.now();
  const supabase = createServiceClient();
  let storedCount = 0;
  const STORE_BATCH_SIZE = 50;

  for (let i = 0; i < mappedJobs.length; i += STORE_BATCH_SIZE) {
    const batchRows = mappedJobs
      .slice(i, i + STORE_BATCH_SIZE)
      .map(({ row }, idx) => ({
        ...row,
        job_embedding: `[${(allEmbeddings[i + idx] ?? []).join(",")}]`,
      })) as TablesInsert<"job_postings">[];

    const { error: upsertError, count } = await supabase
      .from("job_postings")
      .upsert(batchRows, {
        onConflict: "source_url",
        ignoreDuplicates: false,
        count: "exact",
      });

    if (upsertError) {
      errors.push(`Database upsert error: ${upsertError.message}`);
    } else {
      storedCount += count ?? batchRows.length;
    }
  }
  const storeMs = Math.round(performance.now() - storeStart);

  return ok({
    platform: definition.platformName,
    fetched: rawAds.length,
    mapped: mappedJobs.length,
    stored: storedCount,
    skipped: rawAds.length - storedCount,
    errors,
    timing: {
      fetchMs,
      embedMs,
      storeMs,
      totalMs: Math.round(performance.now() - totalStart),
    },
  });
}
