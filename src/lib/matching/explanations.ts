/**
 * Match explanations — generates the per-match summary shown on the matches
 * board.
 *
 * All matches for a user are explained in a SINGLE Gemini call (the CV is the
 * shared context, so per-match calls would resend it N times). Any failure
 * falls back to a deterministic, locale-aware template per match.
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type ResponseSchema,
} from "@google/generative-ai";
import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExplanationJobInput {
  readonly title: string;
  readonly company: string;
  readonly country: string;
  readonly hard_requirements: string[];
}

export interface ExplanationItem {
  readonly job: ExplanationJobInput;
  /** Final (adjusted) similarity score in [0, 1]. */
  readonly similarity: number;
  readonly missingPrerequisites: string[];
}

// ─── Deterministic fallback ──────────────────────────────────────────────────

export function generateDeterministicExplanation(
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

// ─── Batched Gemini explanations ─────────────────────────────────────────────

const EXPLANATION_MODEL = "gemini-2.5-flash";

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.ARRAY,
  items: { type: SchemaType.STRING },
};

const SYSTEM_INSTRUCTION =
  "You are a professional recruitment advisor helping Nordic job seekers. " +
  "For EACH job in the numbered list, analyze the match between the user's CV and that job posting. " +
  "Explain briefly (in 2-3 sentences) why they are a match, highlighting their key strengths and noting any missing requirements. " +
  "Write each explanation in Swedish if the job is in Sweden (country: SE), Norwegian if in Norway (country: NO), or English otherwise. " +
  "Return a JSON array of plain-text strings (no markdown), one per job, in the same order as the input list.";

function deterministicFor(item: ExplanationItem): string {
  return generateDeterministicExplanation(
    Math.round(item.similarity * 100),
    item.job.country,
    item.missingPrerequisites,
  );
}

/**
 * Generates explanations for all matches in one Gemini call.
 *
 * Returns one explanation per input item, in order. Items the model fails to
 * cover (API error, malformed JSON, short array) get the deterministic
 * fallback instead, so the result length always equals `items.length`.
 */
export async function generateMatchExplanationsBatch(
  structuredData: CvStructuredData | undefined,
  items: readonly ExplanationItem[],
): Promise<string[]> {
  if (items.length === 0) return [];

  const fallbacks = items.map(deterministicFor);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fallbacks;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: EXPLANATION_MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const jobsList = items
      .map((item, i) => {
        const pct = Math.round(item.similarity * 100);
        return [
          `Job ${i + 1}:`,
          `- Title: ${item.job.title}`,
          `- Company: ${item.job.company}`,
          `- Location/Country: ${item.job.country}`,
          `- Hard Requirements: ${JSON.stringify(item.job.hard_requirements)}`,
          `- Match Score: ${pct}%`,
          `- Missing Requirements: ${JSON.stringify(item.missingPrerequisites)}`,
        ].join("\n");
      })
      .join("\n\n");

    const prompt = `
User CV Structured Data: ${JSON.stringify(structuredData ?? {})}

Jobs to explain (${items.length} total):

${jobsList}

Generate a highly professional match explanation summary (2-3 sentences) for each job, in the appropriate language (Swedish for SE, Norwegian for NO, English for others). Return a JSON array of exactly ${items.length} strings in the same order as the jobs above.
    `;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: Math.min(16384, 256 + items.length * 250),
        temperature: 0.3,
      },
    });

    const parsed: unknown = JSON.parse(result.response.text());
    if (!Array.isArray(parsed)) {
      return fallbacks;
    }

    return items.map((item, i) => {
      const candidate: unknown = parsed[i];
      return typeof candidate === "string" && candidate.trim().length > 0
        ? candidate.trim()
        : (fallbacks[i] ?? deterministicFor(item));
    });
  } catch (error) {
    console.warn(
      "Gemini batch match explanation failed (possibly quota hit). Falling back to deterministic explanations.",
      error,
    );
    return fallbacks;
  }
}
