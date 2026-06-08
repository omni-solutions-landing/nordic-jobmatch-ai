"use server";

/**
 * Match Actions — Server Action pipeline for matching job postings to user CVs.
 *
 * Strictly typed and functional implementation using the Result wrapper.
 *
 * @module Server Action — runs exclusively on the server.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServerClient } from "@/lib/supabase/server";
import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";
import type { Database, Json } from "@/lib/database.types";
import { translateKeyword } from "@/lib/ai/translation";
import { Result, ok, fail } from "@/lib/fp/result";
import { ProfileId } from "@/lib/fp/branded";

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

const LANGUAGE_MAP: Record<string, string[]> = {
  sv: ["svenska", "swedish", "svensk", "sv"],
  en: ["engelska", "english", "engelsk", "en"],
  no: ["norska", "norwegian", "norsk", "no"],
  da: ["danska", "danish", "dansk", "da"],
  fi: ["finska", "finnish", "finsk", "fi", "suomi"],
};

function checkMissingPrerequisites(
  hardRequirements: string[],
  structuredData?: CvStructuredData,
): string[] {
  if (!structuredData) {
    return [...hardRequirements];
  }

  const missing: string[] = [];

  const technicalSkills = (structuredData.skills?.technical || []).map((s) =>
    s.toLowerCase().trim(),
  );
  const softSkills = (structuredData.skills?.soft || []).map((s) =>
    s.toLowerCase().trim(),
  );
  const toolsSkills = (structuredData.skills?.tools_and_platforms || []).map(
    (s) => s.toLowerCase().trim(),
  );
  const industrySkills = (structuredData.skills?.industry_specific || []).map(
    (s) => s.toLowerCase().trim(),
  );
  const machinerySkills = (
    structuredData.skills?.machinery_and_equipment || []
  ).map((s) => s.toLowerCase().trim());

  const allSkills = [
    ...technicalSkills,
    ...softSkills,
    ...toolsSkills,
    ...industrySkills,
    ...machinerySkills,
  ];

  const certs = (structuredData.certifications || []).map((c) => ({
    name: (c.name || "").toLowerCase().trim(),
    nameEnglish: (c.name_english || "").toLowerCase().trim(),
    nordicCode: (c.nordic_code || "").toLowerCase().trim(),
    licenseClasses: (c.license_classes || []).map((l) =>
      l.toLowerCase().trim(),
    ),
  }));

  const education = (structuredData.education || []).map((e) => ({
    degree: (e.degree || "").toLowerCase().trim(),
    degreeOriginal: (e.degree_original || "").toLowerCase().trim(),
    field: (e.field_of_study || "").toLowerCase().trim(),
  }));

  const languages = (structuredData.languages || []).map((l) => ({
    language: (l.language || "").toLowerCase().trim(),
    iso: (l.iso_code || "").toLowerCase().trim(),
  }));

  for (const req of hardRequirements) {
    const reqLower = req.toLowerCase().trim();
    if (!reqLower) continue;

    const isLicenseReq =
      reqLower.includes("körkort") ||
      reqLower.includes("license") ||
      reqLower.includes("klasse ");
    if (isLicenseReq) {
      const userClasses = certs.flatMap((c) => c.licenseClasses);
      const hasAnyLicense = userClasses.length > 0;

      let requiredClass: string | null = null;
      if (
        reqLower.includes("ce") ||
        reqLower.includes("c e") ||
        reqLower.includes("c-e")
      ) {
        requiredClass = "ce";
      } else if (
        reqLower.includes("c") &&
        !reqLower.includes("ce") &&
        !reqLower.includes("c-e") &&
        !reqLower.includes("c e")
      ) {
        requiredClass = "c";
      } else if (reqLower.includes("b") && !reqLower.includes("be")) {
        requiredClass = "b";
      } else if (reqLower.includes("d")) {
        requiredClass = "d";
      }

      if (requiredClass === null) {
        if (hasAnyLicense) continue;
      } else {
        if (
          requiredClass === "b" &&
          (userClasses.includes("b") ||
            userClasses.includes("c") ||
            userClasses.includes("ce"))
        ) {
          continue;
        }
        if (
          requiredClass === "c" &&
          (userClasses.includes("c") || userClasses.includes("ce"))
        ) {
          continue;
        }
        if (requiredClass === "ce" && userClasses.includes("ce")) {
          continue;
        }
        if (requiredClass === "d" && userClasses.includes("d")) {
          continue;
        }
      }
    }

    const matchInSkills = allSkills.some(
      (skill) =>
        skill === reqLower ||
        skill.includes(reqLower) ||
        reqLower.includes(skill),
    );
    if (matchInSkills) continue;

    const matchInCerts = certs.some(
      (c) =>
        c.name.includes(reqLower) ||
        c.nameEnglish.includes(reqLower) ||
        c.nordicCode === reqLower ||
        c.licenseClasses.includes(reqLower),
    );
    if (matchInCerts) continue;

    const matchInEdu = education.some(
      (e) =>
        e.degree.includes(reqLower) ||
        e.degreeOriginal.includes(reqLower) ||
        e.field.includes(reqLower),
    );
    if (matchInEdu) continue;

    const matchInLang = languages.some((l) => {
      const userIso = l.iso.slice(0, 2);
      const equivalents = LANGUAGE_MAP[userIso] || [l.language, l.iso];
      return equivalents.some(
        (eq) => eq.includes(reqLower) || reqLower.includes(eq),
      );
    });
    if (matchInLang) continue;

    missing.push(req);
  }

  return missing;
}

function generateDeterministicExplanation(
  matchPercentage: number,
  country: string,
  missingPrerequisites: string[],
): string {
  const isNorway = country === "NO";

  if (isNorway) {
    if (missingPrerequisites.length === 0) {
      return `Din profil matcher denne stillingen med ${matchPercentage}% basert på din erfaring og kompetanse. Du oppfyller alle formelle krav til stillingen.`;
    } else {
      const missingList = missingPrerequisites.join(", ");
      return `Din profil matcher denne stillingen med ${matchPercentage}% basert på din erfaring, men du mangler følgende formelle krav: ${missingList}.`;
    }
  } else {
    if (missingPrerequisites.length === 0) {
      return `Din profil matchar denna tjänst med ${matchPercentage}% baserat på din erfarenhet och kompetens. Du uppfyller alla formella krav för tjänsten.`;
    } else {
      const missingList = missingPrerequisites.join(", ");
      return `Din profil matchar denna tjänst med ${matchPercentage}% baserat på din erfarenhet, men du saknar följande formella krav: ${missingList}.`;
    }
  }
}

export async function getMatchExplanation(
  structuredData: CvStructuredData,
  job: {
    readonly title: string;
    readonly company: string;
    readonly description: string;
    readonly country: string;
    readonly hard_requirements: string[];
  },
  similarity: number,
  missingPrerequisites: string[],
): Promise<string> {
  const matchPercentage = Math.round(similarity * 100);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return generateDeterministicExplanation(
      matchPercentage,
      job.country,
      missingPrerequisites,
    );
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction:
        "You are a professional recruitment advisor helping Nordic job seekers. Analyze the match between the user's CV and the job posting. Explain briefly (in 2-3 sentences) why they are a match, highlighting their key strengths and noting any missing requirements. Write the response in Swedish if the job is in Sweden (country: SE), Norwegian if in Norway (country: NO), or English otherwise.",
    });

    const prompt = `
User CV Structured Data: ${JSON.stringify(structuredData)}
Job Posting:
- Title: ${job.title}
- Company: ${job.company}
- Location/Country: ${job.country}
- Hard Requirements: ${JSON.stringify(job.hard_requirements)}
Match Score: ${matchPercentage}%
Missing Requirements: ${JSON.stringify(missingPrerequisites)}

Generate a highly professional match explanation summary (2-3 sentences) in the appropriate language (Swedish for SE, Norwegian for NO, English for others). Do not return markdown, just raw text.
    `;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 250,
        temperature: 0.3,
      },
    });

    const text = result.response.text().trim();
    if (text) {
      return text;
    }
  } catch (error) {
    console.warn(
      "Gemini match explanation failed (possibly quota hit). Falling back to deterministic explanation.",
      error,
    );
  }

  return generateDeterministicExplanation(
    matchPercentage,
    job.country,
    missingPrerequisites,
  );
}

function processMockMatches(structuredData?: CvStructuredData): JobMatch[] {
  const mockScores = [0.88, 0.79, 0.74, 0.67, 0.58];

  const results = MOCK_JOBS.map((job, idx) => {
    const score = mockScores[idx] ?? 0.6;
    const missing = checkMissingPrerequisites(
      job.hard_requirements,
      structuredData,
    );

    let adjustedScore = score;

    const titleLower = job.title.toLowerCase();
    const cvTextLower = JSON.stringify(structuredData || {}).toLowerCase();
    const regulatedTitles = [
      "optiker",
      "sjuksköterska",
      "sjukskötare",
      "sykepleier",
      "nurse",
      "tandläkare",
      "tannlege",
      "läkare",
      "lege",
      "farmaceut",
      "apotekare",
      "psykolog",
      "systemutveckler",
      "software engineer",
      "utvikler",
    ];
    const isRegulatedTitle = regulatedTitles.some((term) =>
      titleLower.includes(term),
    );
    if (isRegulatedTitle) {
      const hasCredential = regulatedTitles.some(
        (term) => titleLower.includes(term) && cvTextLower.includes(term),
      );
      if (!hasCredential) {
        adjustedScore = 0;
      }
    }

    if (adjustedScore > 0 && missing.length > 0) {
      const hasRegulatedRequirement = missing.some((req) => {
        const reqLower = req.toLowerCase();
        return (
          reqLower.includes("legitimerad") ||
          reqLower.includes("sjuksköterska") ||
          reqLower.includes("optiker") ||
          reqLower.includes("fagbrev") ||
          reqLower.includes("hms-kort") ||
          reqLower.includes("ykb") ||
          reqLower.includes("körkort") ||
          reqLower.includes("license")
        );
      });
      if (hasRegulatedRequirement) {
        adjustedScore = 0;
      } else {
        adjustedScore = Math.max(0, adjustedScore - 0.15 * missing.length);
      }
    }

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

    const { data: cvProfile, error: profileError } = (await supabase
      .from("cv_profiles")
      .select("skills_embedding, structured_data")
      .eq("profile_id", brandedProfileId)
      .eq("is_active", true)
      .maybeSingle()) as unknown as {
      data: { skills_embedding: string | null; structured_data: Json } | null;
      error: any;
    };

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

    const rpcResponse = (await (supabase.rpc as any)(
      "match_jobs_with_keywords",
      {
        query_embedding: cvProfile.skills_embedding,
        match_keywords: matchKeywords,
        match_threshold: threshold,
        match_count: matchCount,
        filter_country: filterCountry,
      },
    )) as unknown as {
      data: Array<{
        id: string;
        title: string;
        company: string;
        country: Database["public"]["Enums"]["nordic_country"];
        location: string;
        source_url: string;
        similarity: number;
      }> | null;
      error: any;
    };

    const rpcMatches = rpcResponse.data;
    const rpcError = rpcResponse.error;

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
    const jobsResponse = (await supabase
      .from("job_postings")
      .select(
        "id, title, company, description, location, country, source_url, original_language, salary_info, hard_requirements, expires_at, created_at",
      )
      .in("id", jobIds)) as unknown as {
      data: Array<{
        id: string;
        title: string;
        company: string;
        description: string;
        location: string;
        country: Database["public"]["Enums"]["nordic_country"];
        source_url: string;
        original_language: Database["public"]["Enums"]["source_language"];
        salary_info: Json;
        hard_requirements: string[];
        expires_at: string | null;
        created_at: string;
      }> | null;
      error: any;
    };

    const jobs = jobsResponse.data;
    const jobsError = jobsResponse.error;

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

    const results: JobMatch[] = [];

    for (const match of finalMatches) {
      const job = jobsMap.get(match.id);
      if (!job) continue;

      const missingPrerequisites = checkMissingPrerequisites(
        job.hard_requirements || [],
        structuredData,
      );

      let adjustedScore = match.similarity;

      const titleLower = job.title.toLowerCase();
      const cvTextLower = JSON.stringify(structuredData || {}).toLowerCase();
      const regulatedTitles = [
        "optiker",
        "sjuksköterska",
        "sjukskötare",
        "sykepleier",
        "nurse",
        "tandläkare",
        "tannlege",
        "läkare",
        "lege",
        "farmaceut",
        "apotekare",
        "psykolog",
        "systemutveckler",
        "software engineer",
        "utvikler",
      ];
      const isRegulatedTitle = regulatedTitles.some((term) =>
        titleLower.includes(term),
      );
      if (isRegulatedTitle) {
        const hasCredential = regulatedTitles.some(
          (term) => titleLower.includes(term) && cvTextLower.includes(term),
        );
        if (!hasCredential) {
          adjustedScore = 0;
        }
      }

      if (adjustedScore > 0 && missingPrerequisites.length > 0) {
        const hasRegulatedRequirement = missingPrerequisites.some((req) => {
          const reqLower = req.toLowerCase();
          return (
            reqLower.includes("legitimerad") ||
            reqLower.includes("sjuksköterska") ||
            reqLower.includes("optiker") ||
            reqLower.includes("fagbrev") ||
            reqLower.includes("hms-kort") ||
            reqLower.includes("ykb") ||
            reqLower.includes("körkort") ||
            reqLower.includes("license")
          );
        });

        if (hasRegulatedRequirement) {
          adjustedScore = 0;
        } else {
          adjustedScore = Math.max(
            0,
            adjustedScore - 0.15 * missingPrerequisites.length,
          );
        }
      }

      if (adjustedScore < threshold) {
        continue;
      }

      const explanationSummary = await getMatchExplanation(
        structuredData,
        job,
        adjustedScore,
        missingPrerequisites,
      );

      results.push({
        job_posting: {
          id: job.id,
          title: job.title,
          company: job.company,
          description: job.description,
          location: job.location,
          country: job.country,
          source_url: job.source_url,
          original_language: job.original_language,
          salary_info: job.salary_info,
          hard_requirements: job.hard_requirements,
          expires_at: job.expires_at,
          created_at: job.created_at,
        },
        match_score: adjustedScore,
        missing_prerequisites: missingPrerequisites,
        explanation_summary: explanationSummary,
      });
    }

    return ok(results.sort((a, b) => b.match_score - a.match_score));
  } catch (error: any) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}
