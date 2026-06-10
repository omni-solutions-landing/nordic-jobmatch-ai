/**
 * One-off verification: were stored embeddings regenerated with
 * gemini-embedding-001 after the model migration?
 *
 * Method (dimension is 768 for both old and new model, so instead):
 *  1. L2 norm of stored vectors — text-embedding-004 returned unit-normalized
 *     vectors (norm ≈ 1.0); gemini-embedding-001 truncated to 768-d via
 *     outputDimensionality is NOT unit-normalized (norm typically ≠ 1.0).
 *  2. Self-similarity — re-embed the exact stringified text with the current
 *     model/taskType and compare cosine similarity to the stored vector.
 *     Same model → ≈ 0.99+. Different model → low/incoherent.
 *
 * Run: npx tsx scripts/verify-embeddings.ts
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

// ─── Env loading (.env.local) ────────────────────────────────────────────────

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

// ─── Vector helpers ──────────────────────────────────────────────────────────

function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function l2Norm(v: number[]): number {
  return Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot / (l2Norm(a) * l2Norm(b));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient<Database>(url, serviceKey);

  // ── Counts ──
  const [jobsTotal, jobsNullEmb, cvsTotal, cvsNullEmb] = await Promise.all([
    supabase.from("job_postings").select("id", { count: "exact", head: true }),
    supabase
      .from("job_postings")
      .select("id", { count: "exact", head: true })
      .is("job_embedding", null),
    supabase.from("cv_profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("cv_profiles")
      .select("id", { count: "exact", head: true })
      .is("skills_embedding", null),
  ]);

  console.log("── Row counts ──");
  console.log(`job_postings: ${jobsTotal.count} total, ${jobsNullEmb.count} with NULL embedding`);
  console.log(`cv_profiles:  ${cvsTotal.count} total, ${cvsNullEmb.count} with NULL embedding`);

  // ── Sample job postings: newest 3 + oldest 3 with embeddings ──
  const [newest, oldest] = await Promise.all([
    supabase
      .from("job_postings")
      .select("*")
      .not("job_embedding", "is", null)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("job_postings")
      .select("*")
      .not("job_embedding", "is", null)
      .order("created_at", { ascending: true })
      .limit(3),
  ]);

  if (newest.error || oldest.error) {
    throw new Error(`Job sampling failed: ${newest.error?.message ?? oldest.error?.message}`);
  }

  const seen = new Set<string>();
  const sampleJobs = [...(newest.data ?? []), ...(oldest.data ?? [])].filter((j) => {
    if (seen.has(j.id)) return false;
    seen.add(j.id);
    return true;
  });

  console.log("\n── job_postings sample (norm + self-similarity) ──");
  for (const job of sampleJobs) {
    const stored = parseVector(job.job_embedding);
    if (!stored) {
      console.log(`${job.id} [${job.created_at}] — could not parse stored vector`);
      continue;
    }
    const norm = l2Norm(stored);
    const text = stringifyJobForEmbedding(job);
    const fresh = await generateEmbedding(text, { taskType: "document" });
    const sim = cosineSimilarity(stored, fresh);
    console.log(
      `${job.id} created=${job.created_at} dim=${stored.length} norm=${norm.toFixed(4)} selfSim=${sim.toFixed(4)} | ${job.title.slice(0, 50)}`,
    );
  }

  // ── CV profiles ──
  const cvs = await supabase
    .from("cv_profiles")
    .select("id, profile_id, structured_data, skills_embedding, updated_at, is_active")
    .not("skills_embedding", "is", null);

  if (cvs.error) {
    throw new Error(`CV sampling failed: ${cvs.error.message}`);
  }

  console.log("\n── cv_profiles (norm + self-similarity) ──");
  for (const cv of cvs.data ?? []) {
    const stored = parseVector(cv.skills_embedding);
    if (!stored) {
      console.log(`${cv.id} — could not parse stored vector`);
      continue;
    }
    const norm = l2Norm(stored);
    const structured = cv.structured_data as unknown as CvStructuredData;
    const text = stringifyCvForEmbedding(structured);
    const fresh = await generateEmbedding(text, { taskType: "query" });
    const sim = cosineSimilarity(stored, fresh);
    console.log(
      `${cv.id} active=${cv.is_active} updated=${cv.updated_at} dim=${stored.length} norm=${norm.toFixed(4)} selfSim=${sim.toFixed(4)}`,
    );
  }

  console.log("\nInterpretation:");
  console.log("  selfSim ≥ ~0.97  → stored vector matches current model (regenerated) ✅");
  console.log("  selfSim < ~0.8   → stored vector from a different model/text (STALE) ❌");
  console.log("  norm ≈ 1.0000    → suspicious: text-embedding-004 was unit-normalized");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
