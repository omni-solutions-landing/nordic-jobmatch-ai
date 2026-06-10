/**
 * One-off remediation: regenerate stored embeddings with the current model
 * (gemini-embedding-001, 768-d) after the migration off text-embedding-004.
 *
 * Re-stringifies stored data with the same stringifiers and taskTypes used by
 * the production write paths (cv-actions: query, harvester-pipeline: document),
 * then updates the rows in place.
 *
 * Run: npx tsx scripts/regenerate-embeddings.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";
import { generateEmbedding } from "@/lib/ai/embeddings";
import {
  stringifyCvForEmbedding,
  stringifyJobForEmbedding,
} from "@/lib/ai/embeddings/stringifiers";

function loadEnvLocal(): void {
  const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient<Database>(url, serviceKey);

  // ── CV profiles (taskType: query, matches cv-actions.ts) ──
  const cvs = await supabase
    .from("cv_profiles")
    .select("id, structured_data")
    .not("structured_data", "is", null);
  if (cvs.error) throw new Error(`Fetching cv_profiles failed: ${cvs.error.message}`);

  for (const cv of cvs.data ?? []) {
    const structured = cv.structured_data as unknown as CvStructuredData;
    const text = stringifyCvForEmbedding(structured);
    const embedding = await generateEmbedding(text, { taskType: "query" });
    const { error } = await supabase
      .from("cv_profiles")
      .update({ skills_embedding: JSON.stringify(embedding) })
      .eq("id", cv.id);
    if (error) throw new Error(`Updating cv_profile ${cv.id} failed: ${error.message}`);
    console.log(`cv_profiles ${cv.id}: embedding regenerated`);
  }

  // ── Job postings (taskType: document, matches harvester-pipeline.ts) ──
  const jobs = await supabase.from("job_postings").select("*");
  if (jobs.error) throw new Error(`Fetching job_postings failed: ${jobs.error.message}`);

  for (const job of jobs.data ?? []) {
    const text = stringifyJobForEmbedding(job);
    const embedding = await generateEmbedding(text, { taskType: "document" });
    const { error } = await supabase
      .from("job_postings")
      .update({ job_embedding: JSON.stringify(embedding) })
      .eq("id", job.id);
    if (error) throw new Error(`Updating job_posting ${job.id} failed: ${error.message}`);
    console.log(`job_postings ${job.id}: embedding regenerated`);
  }

  console.log(
    `\nDone. ${cvs.data?.length ?? 0} CV embedding(s), ${jobs.data?.length ?? 0} job embedding(s) regenerated.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
