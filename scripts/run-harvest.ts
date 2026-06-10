/**
 * Manual harvest runner — executes all stable harvesters against the live
 * Supabase database and reports per-source results plus final table counts.
 *
 * Run: npx tsx scripts/run-harvest.ts [limit] [lookbackMinutes]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  const limit = parseInt(process.argv[2] ?? "15", 10);
  const lookback = parseInt(process.argv[3] ?? "10080", 10); // 7 days

  const { harvestSwedishJobs } = await import("@/lib/harvesters/sweden-harvester");
  const { harvestNorwegianJobs } = await import("@/lib/harvesters/norway-harvester");
  const { harvestJobindexJobs } = await import("@/lib/harvesters/jobindex-harvester");
  const { harvestDuunitoriJobs } = await import("@/lib/harvesters/duunitori-harvester");

  const sources = [
    ["sweden", () => harvestSwedishJobs(limit, lookback)],
    ["norway", () => harvestNorwegianJobs(Math.min(limit, 10))],
    ["jobindex", () => harvestJobindexJobs(Math.min(limit, 8), lookback)],
    ["duunitori", () => harvestDuunitoriJobs(Math.min(limit, 8), lookback)],
  ] as const;

  for (const [name, run] of sources) {
    try {
      const res = await run();
      console.log(
        `${name.padEnd(10)} fetched=${res.fetched} mapped=${res.mapped} stored=${res.stored} skipped=${res.skipped} errors=${res.errors.length}`,
      );
      for (const e of res.errors.slice(0, 3)) console.log(`  ! ${e}`);
    } catch (err) {
      console.error(`${name.padEnd(10)} FAILED:`, err instanceof Error ? err.message : err);
    }
  }

  // Verify table contents
  const { createClient } = await import("@supabase/supabase-js");
  type DB = import("@/lib/database.types").Database;
  const supabase = createClient<DB>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { count } = await supabase
    .from("job_postings")
    .select("id", { count: "exact", head: true });
  const { count: nullEmb } = await supabase
    .from("job_postings")
    .select("id", { count: "exact", head: true })
    .is("job_embedding", null);
  const { data: byPlatform } = await supabase
    .from("job_postings")
    .select("source_platform, country");

  const counts = new Map<string, number>();
  for (const row of byPlatform ?? []) {
    const key = `${row.source_platform ?? "?"} (${row.country})`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  console.log(`\njob_postings total: ${count}, NULL embeddings: ${nullEmb}`);
  for (const [key, n] of counts) console.log(`  ${key}: ${n}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
