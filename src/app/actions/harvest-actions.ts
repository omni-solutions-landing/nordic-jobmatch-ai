"use server";

import { harvestSwedishJobs } from "@/lib/harvesters/sweden-harvester";
import { harvestNorwegianJobs } from "@/lib/harvesters/norway-harvester";
import { harvestIndeedJobs } from "@/lib/harvesters/indeed-harvester";
import { harvestJobindexJobs } from "@/lib/harvesters/jobindex-harvester";
import { harvestDuunitoriJobs } from "@/lib/harvesters/duunitori-harvester";
import { harvestFacebookJobs } from "@/lib/harvesters/facebook-harvester";
import { harvestBlocketJobs } from "@/lib/harvesters/blocket-harvester";
import { harvestFinnJobs } from "@/lib/harvesters/finn-harvester";
import { revalidatePath } from "next/cache";
import { translateKeyword } from "@/lib/ai/translation";

export interface HarvestActionResponse {
  success: boolean;
  results?: {
    sweden?: { fetched: number; mapped: number; stored: number; skipped: number };
    norway?: { discovered: number; active: number; fetched: number; mapped: number; stored: number; skipped: number };
    indeed?: { fetched: number; mapped: number; stored: number; skipped: number };
    jobindex?: { fetched: number; mapped: number; stored: number; skipped: number };
    duunitori?: { fetched: number; mapped: number; stored: number; skipped: number };
    facebook?: { fetched: number; mapped: number; stored: number; skipped: number };
    blocket?: { fetched: number; mapped: number; stored: number; skipped: number };
    finn?: { fetched: number; mapped: number; stored: number; skipped: number };
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
  const [keywordNo, keywordDa, keywordFi] = await Promise.all([
    rawKeyword ? translateKeyword(rawKeyword, "no") : Promise.resolve(""),
    rawKeyword ? translateKeyword(rawKeyword, "da") : Promise.resolve(""),
    rawKeyword ? translateKeyword(rawKeyword, "fi") : Promise.resolve(""),
  ]);

  console.log(`[triggerHarvestAction] Keyword translations: Original="${rawKeyword}", NO="${keywordNo}", DA="${keywordDa}", FI="${keywordFi}"`);

  // Run all harvesters in parallel (with translated keywords)
  const runs = [
    // 1. Sweden (Platsbanken) - uses original Swedish keyword
    (async () => {
      try {
        const res = await harvestSwedishJobs(formData.limit, publishedAfterMinutes, rawKeyword || undefined);
        results.sweden = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err: any) {
        errors.push(`Sverige: ${err.message}`);
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
      } catch (err: any) {
        errors.push(`Norge: ${err.message}`);
      }
    })(),

    // 3. Indeed
    (async () => {
      try {
        const res = await harvestIndeedJobs(formData.limit, publishedAfterMinutes, rawKeyword || undefined);
        results.indeed = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err: any) {
        errors.push(`Indeed: ${err.message}`);
      }
    })(),

    // 4. Jobindex (Denmark) - uses translated Danish keyword
    (async () => {
      try {
        const res = await harvestJobindexJobs(formData.limit, publishedAfterMinutes, keywordDa || undefined);
        results.jobindex = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err: any) {
        errors.push(`Jobindex (DK): ${err.message}`);
      }
    })(),

    // 5. Duunitori (Finland) - uses translated Finnish keyword
    (async () => {
      try {
        const res = await harvestDuunitoriJobs(formData.limit, publishedAfterMinutes, keywordFi || undefined);
        results.duunitori = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err: any) {
        errors.push(`Duunitori (FI): ${err.message}`);
      }
    })(),

    // 6. Facebook Groups - searches with combined or original keywords
    (async () => {
      try {
        const res = await harvestFacebookJobs(formData.limit, publishedAfterMinutes, rawKeyword || undefined);
        results.facebook = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err: any) {
        errors.push(`Facebook: ${err.message}`);
      }
    })(),

    // 7. Blocket Jobb - uses original Swedish keyword
    (async () => {
      try {
        const res = await harvestBlocketJobs(formData.limit, publishedAfterMinutes, rawKeyword || undefined);
        results.blocket = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err: any) {
        errors.push(`Blocket: ${err.message}`);
      }
    })(),

    // 8. FINN.no (Norway) - uses translated Norwegian keyword
    (async () => {
      try {
        const res = await harvestFinnJobs(formData.limit, publishedAfterMinutes, keywordNo || undefined);
        results.finn = { fetched: res.fetched, mapped: res.mapped, stored: res.stored, skipped: res.skipped };
      } catch (err: any) {
        errors.push(`FINN.no: ${err.message}`);
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
