"use server";

import { harvestSwedishJobs } from "@/lib/harvesters/sweden-harvester";
import { harvestNorwegianJobs } from "@/lib/harvesters/norway-harvester";
import { harvestJobindexJobs } from "@/lib/harvesters/jobindex-harvester";
import { harvestDuunitoriJobs } from "@/lib/harvesters/duunitori-harvester";
import { harvestFacebookJobs } from "@/lib/harvesters/facebook-harvester";
import { revalidatePath } from "next/cache";
import { translateKeyword } from "@/lib/ai/translation";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface HarvestActionResponse {
  success: boolean;
  results?: {
    sweden?: { fetched: number; mapped: number; stored: number; skipped: number };
    norway?: { discovered: number; active: number; fetched: number; mapped: number; stored: number; skipped: number };
    jobindex?: { fetched: number; mapped: number; stored: number; skipped: number };
    duunitori?: { fetched: number; mapped: number; stored: number; skipped: number };
    facebook?: { fetched: number; mapped: number; stored: number; skipped: number };
  };
  error?: string;
}

export async function triggerHarvestAction(formData: {
  lookbackDays: number;
  limit: number;
  keyword?: string;
}): Promise<HarvestActionResponse> {
  const publishedAfterMinutes = formData.lookbackDays * 24 * 60;
  const results: HarvestActionResponse["results"] = {};
  const errors: string[] = [];

  const rawKeyword = formData.keyword?.trim() || "";

  // Pre-translate search keywords for target country languages in parallel
  const [keywordDa, keywordFi] = await Promise.all([
    rawKeyword ? translateKeyword(rawKeyword, "da") : Promise.resolve(""),
    rawKeyword ? translateKeyword(rawKeyword, "fi") : Promise.resolve(""),
  ]);

  console.log(`[triggerHarvestAction] Keyword translations: Original="${rawKeyword}", DA="${keywordDa}", FI="${keywordFi}"`);

  // Run all harvesters in parallel (with translated keywords)
  const runs = [
    // 1. Sweden (Platsbanken) - uses original Swedish keyword
    (async () => {
      try {
        const res = await harvestSwedishJobs(formData.limit, publishedAfterMinutes, rawKeyword || undefined);
        results.sweden = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err) {
        errors.push(`Sverige: ${errorMessage(err)}`);
      }
    })(),

    // 2. Norway (NAV) - NAV stilling-feed does not support keyword filtering at search time, but we harvest general jobs
    (async () => {
      try {
        const res = await harvestNorwegianJobs(formData.limit);
        results.norway = {
          discovered: res.discovered,
          active: res.active,
          fetched: res.fetched,
          mapped: res.mapped,
          stored: res.stored,
          skipped: res.skipped,
        };
      } catch (err) {
        errors.push(`Norge: ${errorMessage(err)}`);
      }
    })(),

    // 4. Jobindex (Denmark) - uses translated Danish keyword
    (async () => {
      try {
        const res = await harvestJobindexJobs(formData.limit, publishedAfterMinutes, keywordDa || undefined);
        results.jobindex = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err) {
        errors.push(`Jobindex (DK): ${errorMessage(err)}`);
      }
    })(),

    // 5. Duunitori (Finland) - uses translated Finnish keyword
    (async () => {
      try {
        const res = await harvestDuunitoriJobs(formData.limit, publishedAfterMinutes, keywordFi || undefined);
        results.duunitori = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err) {
        errors.push(`Duunitori (FI): ${errorMessage(err)}`);
      }
    })(),

    // 6. Facebook Groups - searches with combined or original keywords
    (async () => {
      try {
        const res = await harvestFacebookJobs(formData.limit, publishedAfterMinutes, rawKeyword || undefined);
        results.facebook = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err) {
        errors.push(`Facebook: ${errorMessage(err)}`);
      }
    })(),

  ];

  await Promise.all(runs);

  // Revalidate matches lists so new jobs display instantly
  revalidatePath("/matches");
  revalidatePath("/[locale]/(dashboard)/matches", "page");

  const success = Object.keys(results).length > 0;

  return {
    success,
    results,
    error: errors.length > 0 ? errors.join(" | ") : undefined,
  };
}
