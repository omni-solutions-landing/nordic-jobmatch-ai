"use server";

/**
 * Match Actions — Server Action pipeline for matching job postings to user CVs.
 *
 * Strictly typed and functional implementation using the Result wrapper.
 *
 * @module Server Action — runs exclusively on the server.
 */

import { createServerClient } from "@/lib/supabase/server";
import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";
import type { Database, Json } from "@/lib/database.types";
import { translateKeyword } from "@/lib/ai/translation";
import { Result, ok, fail } from "@/lib/fp/result";
import { ProfileId } from "@/lib/fp/branded";
import {
  checkMissingPrerequisites,
  adjustMatchScore,
} from "@/lib/matching/prerequisites";
import {
  generateDeterministicExplanation,
  generateMatchExplanationsBatch,
} from "@/lib/matching/explanations";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JobMatch {
  readonly job_posting: {
    readonly id: string;
    readonly title: string;
    readonly company: string;
    readonly description: string;
    readonly location: string;
    readonly country: Database["public"]["Enums"]["nordic_country"];
    readonly source_url: string;
    readonly original_language: Database["public"]["Enums"]["source_language"];
    readonly salary_info: Json;
    readonly hard_requirements: string[];
    readonly expires_at: string | null;
    readonly created_at: string;
  };
  readonly match_score: number;
  readonly missing_prerequisites: string[];
  readonly explanation_summary: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MOCK_JOBS = [
  {
    id: "mock-job-1-ce-truck",
    title: "Lastbilschaufför CE till Stockholm",
    company: "Svea Logistik AB",
    description:
      "Vi söker en pålitlig distributionstransportör för heltidsarbete i Göteborg med omnejd. Du kommer att köra tunga fordon och behöver därför giltigt CE-körkort och yrkeskompetensbevis (YKB).",
    location: "Stockholm",
    country: "SE" as const,
    source_url: "https://example.com/jobs/1",
    original_language: "sv" as const,
    salary_info: {
      currency: "SEK",
      min: 32000,
      max: 38000,
      period: "monthly",
    } as Json,
    hard_requirements: ["CE", "YKB"],
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: "mock-job-2-ts-dev",
    title: "Senior Systemutveckler TypeScript",
    company: "TechNordic AS",
    description:
      "Vi søker en seniorutvikler som brenner for TypeScript, Node.js og React. Du vil jobbe i et smidig team med å bygge våre fremtidige skybaserte tjenester på AWS.",
    location: "Oslo",
    country: "NO" as const,
    source_url: "https://example.com/jobs/2",
    original_language: "no" as const,
    salary_info: {
      currency: "NOK",
      min: 700000,
      max: 900000,
      period: "yearly",
    } as Json,
    hard_requirements: ["TypeScript", "React", "Node.js"],
    expires_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: "mock-job-3-nurse",
    title: "Legitimerad Sjuksköterska",
    company: "Region Stockholm",
    description:
      "Välkommen till vår kardiologavdelning! Vi söker dig som är legitimerad sjuksköterska och vill ge bästa möjliga vård till våra patienter. Tidrapportering och journalföring sker på svenska.",
    location: "Stockholm",
    country: "SE" as const,
    source_url: "https://example.com/jobs/3",
    original_language: "sv" as const,
    salary_info: {
      currency: "SEK",
      min: 36000,
      max: 45000,
      period: "monthly",
    } as Json,
    hard_requirements: ["Legitimerad Sjuksköterska", "Svenska"],
    expires_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: "mock-job-4-carpenter",
    title: "Tømrer med fagbrev",
    company: "Norsk Bygg AS",
    description:
      "Vi har stor pågang og søker dyktige tømrere med fagbrev til spennende prosjekter i Bergen. Du må kunne jobbe selvstendig og ha gyldig HMS-kort.",
    location: "Bergen",
    country: "NO" as const,
    source_url: "https://example.com/jobs/4",
    original_language: "no" as const,
    salary_info: {
      currency: "NOK",
      min: 250,
      max: 320,
      period: "hourly",
    } as Json,
    hard_requirements: ["Fagbrev", "HMS-kort"],
    expires_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: "mock-job-5-waiter",
    title: "Serveringspersonal / Waiter",
    company: "Fjällrestaurangen Kvitfjell",
    description:
      "Vi søker etter serviceinnstilte servitører til vintersesongen. Du har erfaring fra restaurantbransjen, kunnskap om mat og drikke, og snakker engelsk eller skandinavisk.",
    location: "Kvitfjell",
    country: "NO" as const,
    source_url: "https://example.com/jobs/5",
    original_language: "no" as const,
    salary_info: {
      currency: "NOK",
      min: 180,
      max: 220,
      period: "hourly",
    } as Json,
    hard_requirements: ["Hygienpass"],
    expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function processMockMatches(structuredData?: CvStructuredData): JobMatch[] {
  const mockScores = [0.88, 0.79, 0.74, 0.67, 0.58];

  const results = MOCK_JOBS.map((job, idx) => {
    const score = mockScores[idx] ?? 0.6;
    const missing = checkMissingPrerequisites(
      job.hard_requirements,
      structuredData,
    );

    const adjustedScore = adjustMatchScore(
      score,
      job.title,
      structuredData,
      missing,
    );

    const explanation = generateDeterministicExplanation(
      Math.round(adjustedScore * 100),
      job.country,
      missing,
    );

    return {
      job_posting: {
        ...job,
        expires_at: job.expires_at,
        created_at: job.created_at,
      },
      match_score: adjustedScore,
      missing_prerequisites: missing,
      explanation_summary: explanation,
    };
  });

  return results
    .filter((m) => m.match_score >= 0.5)
    .sort((a, b) => b.match_score - a.match_score);
}

// ─── Main Action ─────────────────────────────────────────────────────────────

export async function getMatchesForUser(
  profileId: string,
  options?: {
    readonly limit?: number;
    readonly threshold?: number;
    readonly countries?: string[];
    readonly keywords?: string[];
  },
): Promise<Result<JobMatch[], Error>> {
  try {
    const brandedProfileId = profileId as ProfileId;
    const supabase = await createServerClient();

    const { data: cvProfile, error: profileError } = await supabase
      .from("cv_profiles")
      .select("skills_embedding, structured_data")
      .eq("profile_id", brandedProfileId)
      .eq("is_active", true)
      .maybeSingle();

    if (profileError) {
      console.error("Error fetching CV profile:", profileError);
      return ok(processMockMatches());
    }

    if (!cvProfile || !cvProfile.skills_embedding) {
      console.info("User has no skills embedding. Returning mock matches.");
      const structData = cvProfile?.structured_data
        ? (cvProfile.structured_data as unknown as CvStructuredData)
        : undefined;
      return ok(processMockMatches(structData));
    }

    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0.5;
    const countries = options?.countries ?? [];

    let filterCountry: "SE" | "NO" | "DK" | "FI" | undefined = undefined;
    if (
      countries.length === 1 &&
      ["SE", "NO", "DK", "FI"].includes(countries[0]!)
    ) {
      filterCountry = countries[0] as "SE" | "NO" | "DK" | "FI";
    }

    const matchCount = countries.length > 1 ? 100 : limit;

    const rawKeywords = options?.keywords || [];
    let matchKeywords = [...rawKeywords];

    if (rawKeywords.length > 0) {
      try {
        const translationPromises = rawKeywords.flatMap((kw) => [
          translateKeyword(kw, "no"),
          translateKeyword(kw, "da"),
          translateKeyword(kw, "fi"),
          translateKeyword(kw, "en"),
          translateKeyword(kw, "sv"),
        ]);
        const translations = await Promise.all(translationPromises);
        const uniqueTranslations = Array.from(
          new Set(
            translations
              .map((t) => t.trim())
              .filter((t) => t.length > 0),
          ),
        );

        const unionSet = new Set<string>();
        for (const kw of rawKeywords) {
          unionSet.add(kw.trim().toLowerCase());
        }
        for (const t of uniqueTranslations) {
          unionSet.add(t.toLowerCase());
        }
        matchKeywords = Array.from(unionSet);
      } catch (err) {
        console.warn(
          "[getMatchesForUser] Auto-translation of keywords failed:",
          err,
        );
      }
    }

    const { data: rpcMatches, error: rpcError } = await supabase.rpc(
      "match_jobs_with_keywords",
      {
        query_embedding: cvProfile.skills_embedding,
        match_keywords: matchKeywords,
        match_threshold: threshold,
        match_count: matchCount,
        filter_country: filterCountry,
      },
    );

    if (rpcError) {
      console.error("Supabase match_jobs RPC failed:", rpcError);
      return ok(
        processMockMatches(
          cvProfile.structured_data as unknown as CvStructuredData,
        ),
      );
    }

    if (!rpcMatches || rpcMatches.length === 0) {
      return ok([]);
    }

    let filteredMatches = rpcMatches;
    if (countries.length > 1) {
      filteredMatches = rpcMatches.filter((m) => countries.includes(m.country));
    }

    const finalMatches = filteredMatches.slice(0, limit);
    if (finalMatches.length === 0) {
      return ok([]);
    }

    const jobIds = finalMatches.map((m) => m.id);
    const { data: jobs, error: jobsError } = await supabase
      .from("job_postings")
      .select(
        "id, title, company, description, location, country, source_url, original_language, salary_info, hard_requirements, expires_at, created_at",
      )
      .in("id", jobIds);

    if (jobsError) {
      console.error("Error fetching job postings details:", jobsError);
      return ok(
        processMockMatches(
          cvProfile.structured_data as unknown as CvStructuredData,
        ),
      );
    }

    const jobsMap = new Map(jobs?.map((j) => [j.id, j]));
    const structuredData = cvProfile.structured_data as unknown as CvStructuredData;

    // First pass: score and filter. Explanations are generated afterwards in
    // a single batched Gemini call (one per user, not one per match).
    type JobRow = NonNullable<ReturnType<typeof jobsMap.get>>;
    const candidates: Array<{
      job: JobRow;
      adjustedScore: number;
      missingPrerequisites: string[];
    }> = [];

    for (const match of finalMatches) {
      const job = jobsMap.get(match.id);
      if (!job) continue;

      const missingPrerequisites = checkMissingPrerequisites(
        job.hard_requirements || [],
        structuredData,
      );

      const adjustedScore = adjustMatchScore(
        match.similarity,
        job.title,
        structuredData,
        missingPrerequisites,
      );

      if (adjustedScore < threshold) {
        continue;
      }

      candidates.push({ job, adjustedScore, missingPrerequisites });
    }

    const explanations = await generateMatchExplanationsBatch(
      structuredData,
      candidates.map((c) => ({
        job: {
          title: c.job.title,
          company: c.job.company,
          country: c.job.country,
          hard_requirements: c.job.hard_requirements || [],
        },
        similarity: c.adjustedScore,
        missingPrerequisites: c.missingPrerequisites,
      })),
    );

    const results: JobMatch[] = candidates.map((c, i) => ({
      job_posting: {
        id: c.job.id,
        title: c.job.title,
        company: c.job.company,
        description: c.job.description,
        location: c.job.location,
        country: c.job.country,
        source_url: c.job.source_url,
        original_language: c.job.original_language,
        salary_info: c.job.salary_info,
        hard_requirements: c.job.hard_requirements,
        expires_at: c.job.expires_at,
        created_at: c.job.created_at,
      },
      match_score: c.adjustedScore,
      missing_prerequisites: c.missingPrerequisites,
      explanation_summary:
        explanations[i] ??
        generateDeterministicExplanation(
          Math.round(c.adjustedScore * 100),
          c.job.country,
          c.missingPrerequisites,
        ),
    }));

    return ok(results.sort((a, b) => b.match_score - a.match_score));
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}
