import { NextRequest, NextResponse } from "next/server";

// Harvester cron endpoint — triggers job harvesting from Nordic APIs.
//
// Security: Validates CRON_SECRET header to prevent unauthorized invocation.
// Deploy as Vercel Cron via vercel.json:
//   { "crons": [{ "path": "/api/cron/harvest", "schedule": "0 0/4 * * *" }] }
//
// Or invoke manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/harvest

export const runtime = "nodejs";
export const maxDuration = 120; // 2 minutes — harvesters need time

export async function GET(request: NextRequest) {
  // Validate authorization
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // Sweden harvester
  try {
    const { harvestSwedishJobs } = await import("@/lib/harvesters/sweden-harvester");
    const seResult = await harvestSwedishJobs(50, 240); // 50 jobs, published in last 4 hours
    results.sweden = seResult;
  } catch (error) {
    const msg = `Sweden harvest failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    errors.push(msg);
  }

  // Norway harvester
  try {
    const { harvestNorwegianJobs } = await import("@/lib/harvesters/norway-harvester");
    const noResult = await harvestNorwegianJobs(50);
    results.norway = noResult;
  } catch (error) {
    const msg = `Norway harvest failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    errors.push(msg);
  }

  const status = errors.length === 0 ? 200 : 207; // 207 Multi-Status if partial failure

  return NextResponse.json(
    {
      ok: errors.length === 0,
      timestamp: new Date().toISOString(),
      results,
      errors: errors.length > 0 ? errors : undefined,
    },
    { status }
  );
}
