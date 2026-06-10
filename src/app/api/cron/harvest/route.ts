import { NextRequest, NextResponse } from "next/server";
import { translateKeyword } from "@/lib/ai/translation";

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

  // Parse parameters from query string
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const publishedAfterParam = searchParams.get("publishedAfter");
  // Daily cron must look back a full day (plus overlap); source_url upserts dedupe reruns.
  const publishedAfter = publishedAfterParam ? parseInt(publishedAfterParam, 10) : 1500;
  const q = searchParams.get("q") || undefined;

  // Pre-translate search keywords for target country languages in parallel
  const [keywordDa, keywordFi] = await Promise.all([
    q ? translateKeyword(q, "da") : Promise.resolve(""),
    q ? translateKeyword(q, "fi") : Promise.resolve(""),
  ]);
  
  const platformsParam = searchParams.get("platforms");
  const platforms = platformsParam
    ? platformsParam.split(",").map((p) => p.trim().toLowerCase())
    : ["sweden", "norway", "jobindex", "duunitori", "jooble"]; // all stable feeds for standard cron

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  const tasks: Promise<void>[] = [];

  // 1. Sweden (Platsbanken)
  if (platforms.includes("sweden") || platforms.includes("platsbanken")) {
    tasks.push((async () => {
      try {
        const { harvestSwedishJobs } = await import("@/lib/harvesters/sweden-harvester");
        const seResult = await harvestSwedishJobs(limit, publishedAfter, q);
        results.sweden = seResult;
      } catch (error) {
        const msg = `Sweden harvest failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        errors.push(msg);
      }
    })());
  }

  // 2. Norway (NAV)
  if (platforms.includes("norway") || platforms.includes("arbeidsplassen")) {
    tasks.push((async () => {
      try {
        const { harvestNorwegianJobs } = await import("@/lib/harvesters/norway-harvester");
        const noResult = await harvestNorwegianJobs(limit);
        results.norway = noResult;
      } catch (error) {
        const msg = `Norway harvest failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        errors.push(msg);
      }
    })());
  }

  // 4. Jobindex (Denmark)
  if (platforms.includes("jobindex") || platforms.includes("denmark")) {
    tasks.push((async () => {
      try {
        const { harvestJobindexJobs } = await import("@/lib/harvesters/jobindex-harvester");
        const res = await harvestJobindexJobs(limit, publishedAfter, keywordDa || q);
        results.jobindex = res;
      } catch (error) {
        const msg = `Jobindex harvest failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        errors.push(msg);
      }
    })());
  }

  // 5. Duunitori (Finland)
  if (platforms.includes("duunitori") || platforms.includes("finland")) {
    tasks.push((async () => {
      try {
        const { harvestDuunitoriJobs } = await import("@/lib/harvesters/duunitori-harvester");
        const res = await harvestDuunitoriJobs(limit, publishedAfter, keywordFi || q);
        results.duunitori = res;
      } catch (error) {
        const msg = `Duunitori harvest failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        errors.push(msg);
      }
    })());
  }

  // 6. Facebook Groups
  if (platforms.includes("facebook")) {
    tasks.push((async () => {
      try {
        const { harvestFacebookJobs } = await import("@/lib/harvesters/facebook-harvester");
        const res = await harvestFacebookJobs(limit, publishedAfter, q);
        results.facebook = res;
      } catch (error) {
        const msg = `Facebook harvest failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        errors.push(msg);
      }
    })());
  }

  // Jooble partner API (all four Nordic countries, one request each)
  if (platforms.includes("jooble")) {
    tasks.push((async () => {
      try {
        const { harvestJoobleJobs } = await import("@/lib/harvesters/jooble-harvester");
        const res = await harvestJoobleJobs(limit, publishedAfter, q);
        results.jooble = res;
      } catch (error) {
        const msg = `Jooble harvest failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        errors.push(msg);
      }
    })());
  }

  await Promise.all(tasks);

  // Trigger notifications for new matches
  let notifications = null;
  try {
    const { matchAndAlertUsersOfNewJobs } = await import("@/lib/infrastructure/notifications/service");
    notifications = await matchAndAlertUsersOfNewJobs();
  } catch (error) {
    const msg = `Notifications dispatch failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    errors.push(msg);
  }

  const status = errors.length === 0 ? 200 : 207; // 207 Multi-Status if partial failure

  return NextResponse.json(
    {
      ok: errors.length === 0,
      timestamp: new Date().toISOString(),
      results,
      notifications,
      errors: errors.length > 0 ? errors : undefined,
    },
    { status }
  );
}
