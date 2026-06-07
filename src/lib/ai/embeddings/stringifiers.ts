/**
 * Semantic Stringifiers — Text flatteners for embedding generation
 *
 * These functions convert structured data into dense, semantically rich
 * plain text optimized for the text-embedding-004 model.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ DESIGN PHILOSOPHY: Cross-Border Multilingual Matching                  │
 * │                                                                        │
 * │ The key challenge: A Swedish CV must match a Norwegian job posting.     │
 * │ text-embedding-004 is multilingual, but embedding quality improves     │
 * │ when the model sees BOTH the original Nordic term AND its English      │
 * │ equivalent. This creates a "semantic bridge" in the vector space:      │
 * │                                                                        │
 * │   "Svetsare (Welder)" in a Swedish CV                                 │
 * │     ↕ high cosine similarity ↕                                        │
 * │   "Sveiser (Welder)" in a Norwegian job posting                       │
 * │                                                                        │
 * │ Both embed near the English anchor "Welder", enabling cross-lingual   │
 * │ matching without explicit translation at query time.                   │
 * │                                                                        │
 * │ The stringifiers also use LABELED SECTIONS ("SKILLS:", "CERTS:")      │
 * │ because embedding models trained on web text understand structured    │
 * │ document patterns and weigh labeled content more appropriately.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";
import type { Tables } from "@/lib/database.types";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Job posting row from the database */
type JobPosting = Tables<"job_postings">;

/**
 * Raw job data from a Nordic API harvester, before DB insertion.
 * More permissive than the DB row — allows partial data.
 */
export interface RawJobData {
  title: string;
  company?: string;
  description: string;
  location?: string;
  country: "SE" | "NO" | "DK" | "FI";
  hard_requirements?: string[];
  salary_info?: {
    currency?: string;
    min?: number;
    max?: number;
    period?: string;
  };
  /** Original-language title if different from the normalized one */
  original_title?: string;
  /** Original-language description snippet */
  original_description_excerpt?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
};

/**
 * Joins non-empty strings with a separator, filtering out blanks.
 */
function joinNonEmpty(parts: (string | undefined | null)[], sep = " | "): string {
  return parts.filter((p) => p && p.trim().length > 0).join(sep);
}

/**
 * Formats a labeled section. Returns empty string if content is empty.
 * Example: section("SKILLS", ["Python", "React"]) → "SKILLS: Python, React"
 */
function section(label: string, items: string[] | string): string {
  if (Array.isArray(items)) {
    const filtered = items.filter((i) => i.trim().length > 0);
    if (filtered.length === 0) return "";
    return `${label}: ${filtered.join(", ")}`;
  }
  return items.trim().length > 0 ? `${label}: ${items}` : "";
}

// ─── CV Stringifier ──────────────────────────────────────────────────────────

/**
 * Converts structured CV data into a semantically dense embedding string.
 *
 * The output format is designed to:
 *  1. Front-load the most matchable fields (title/summary, skills, certs)
 *  2. Include bilingual anchors (original + English) for cross-lingual matching
 *  3. Use labeled sections for structural clarity
 *  4. Keep total length under ~8000 chars (well within embedding model limits)
 *
 * @param cv - Validated CvStructuredData from the parser.
 * @returns Dense text string optimized for embedding.
 *
 * @example
 * ```
 * PROFESSIONAL PROFILE: Experienced structural engineer specializing in...
 * TARGET COUNTRIES: Sweden, Norway
 * SKILLS: Structural analysis, AutoCAD, Revit, BIM coordination
 * CERTIFICATIONS: ID06 (construction_safety), YKB (professional_driver), CE driver license
 * EXPERIENCE: Structural Engineer (Konstruktionsingenjör) at Skanska, Sweden (2019-01 to present)...
 * EDUCATION: Master's Degree (Civilingenjör) in Civil Engineering, KTH Royal Institute of Technology
 * LANGUAGES: Swedish (native), English (fluent), Norwegian (professional)
 * EQUIPMENT: Excavator, Tower crane, Total station
 * ```
 */
export function stringifyCvForEmbedding(cv: CvStructuredData): string {
  const parts: string[] = [];

  // ── 1. Professional summary (highest signal) ────────────────────────────
  if (cv.professional_summary) {
    parts.push(section("PROFESSIONAL PROFILE", cv.professional_summary));
  }

  // ── 2. Target geography (critical for cross-border matching) ────────────
  const targetCountries = cv.personal.preferred_target_countries
    .map((c) => COUNTRY_NAMES[c] ?? c)
    .join(", ");
  if (targetCountries) {
    parts.push(section("TARGET COUNTRIES", targetCountries));
  }

  const currentLocation = joinNonEmpty([
    cv.personal.location.city,
    cv.personal.location.region,
    COUNTRY_NAMES[cv.personal.location.country_code] ?? cv.personal.location.country_code,
  ]);
  if (currentLocation) {
    parts.push(section("LOCATION", currentLocation));
  }

  // ── 3. All skills merged (high-density matching signal) ─────────────────
  const allSkills = [
    ...cv.skills.technical,
    ...cv.skills.tools_and_platforms,
    ...cv.skills.industry_specific,
    ...cv.skills.machinery_and_equipment,
  ];
  if (allSkills.length > 0) {
    parts.push(section("SKILLS", allSkills));
  }
  if (cv.skills.soft.length > 0) {
    parts.push(section("SOFT SKILLS", cv.skills.soft));
  }

  // ── 4. Certifications with Nordic codes (unique matching signal) ────────
  // Format: "ID06 (construction_safety, Sweden)", "YKB (professional_driver, EU/EEA)"
  const certStrings = cv.certifications.map((cert) => {
    const codePart = cert.nordic_code ? `${cert.nordic_code} — ` : "";
    const namePart = cert.name_english || cert.name;
    const categoryPart = cert.category.replace(/_/g, " ");
    const validityPart = cert.cross_border_validity
      ? `, ${cert.cross_border_validity}`
      : "";
    const classesPart =
      cert.license_classes.length > 0
        ? ` [${cert.license_classes.join("/")}]`
        : "";
    return `${codePart}${namePart} (${categoryPart}${classesPart}${validityPart})`;
  });
  if (certStrings.length > 0) {
    parts.push(section("CERTIFICATIONS", certStrings));
  }

  // ── 5. Experience (bilingual title + company + key details) ─────────────
  const expStrings = cv.experiences.map((exp) => {
    const titleBilingual =
      exp.job_title_original && exp.job_title_original !== exp.job_title
        ? `${exp.job_title} (${exp.job_title_original})`
        : exp.job_title;
    const period = exp.is_current
      ? `${exp.start_date} to present`
      : `${exp.start_date} to ${exp.end_date}`;
    const loc = joinNonEmpty([
      exp.company,
      COUNTRY_NAMES[exp.country_code] ?? exp.country_code,
    ]);
    const techPart =
      exp.technologies_and_tools.length > 0
        ? ` — Tools: ${exp.technologies_and_tools.join(", ")}`
        : "";
    return `${titleBilingual} at ${loc} (${period})${techPart}. ${exp.description}`;
  });
  if (expStrings.length > 0) {
    parts.push(section("EXPERIENCE", "\n" + expStrings.join("\n")));
  }

  // ── 6. Education (bilingual degree) ─────────────────────────────────────
  const eduStrings = cv.education.map((edu) => {
    const degreeBilingual =
      edu.degree_original && edu.degree_original !== edu.degree
        ? `${edu.degree} (${edu.degree_original})`
        : edu.degree;
    const loc = joinNonEmpty([
      edu.institution,
      COUNTRY_NAMES[edu.country_code] ?? edu.country_code,
    ]);
    return `${degreeBilingual} in ${edu.field_of_study}, ${loc}`;
  });
  if (eduStrings.length > 0) {
    parts.push(section("EDUCATION", eduStrings));
  }

  // ── 7. Languages (explicit proficiency for cross-border scoring) ────────
  const langStrings = cv.languages.map(
    (lang) => `${lang.language} (${lang.proficiency})`,
  );
  if (langStrings.length > 0) {
    parts.push(section("LANGUAGES", langStrings));
  }

  // ── 8. Equipment/machinery (for trades/blue-collar matching) ────────────
  if (cv.skills.machinery_and_equipment.length > 0) {
    parts.push(
      section("EQUIPMENT AND MACHINERY", cv.skills.machinery_and_equipment),
    );
  }

  // ── 9. Work permit (affects match viability) ────────────────────────────
  if (cv.personal.work_permit_status) {
    parts.push(section("WORK AUTHORIZATION", cv.personal.work_permit_status));
  }

  return parts.filter((p) => p.length > 0).join("\n");
}

// ─── Job Stringifier ─────────────────────────────────────────────────────────

/**
 * Converts a job posting (DB row or raw harvester data) into a dense
 * embedding string.
 *
 * Accepts both:
 *  - `Tables<"job_postings">` (from database queries)
 *  - `RawJobData` (from harvesters, before DB insertion)
 *
 * The output front-loads title and requirements, which are the strongest
 * matching signals. Description is included but trimmed to avoid diluting
 * the embedding with boilerplate "about the company" text.
 *
 * @example
 * ```
 * JOB: Senior Structural Engineer (Konstruktionsingenjör)
 * COMPANY: Skanska | Stockholm, Sweden
 * REQUIREMENTS: CE driver license, ID06, 5 years structural engineering experience
 * DESCRIPTION: We are looking for an experienced structural engineer to join our...
 * SALARY: 45000-55000 SEK monthly
 * ```
 */
export function stringifyJobForEmbedding(
  job: JobPosting | RawJobData,
): string {
  const parts: string[] = [];

  // ── 1. Title (highest signal) ───────────────────────────────────────────
  // Include original-language title if available (for cross-lingual bridge)
  const hasOriginalTitle =
    "original_title" in job &&
    job.original_title &&
    job.original_title !== job.title;
  const titleLine = hasOriginalTitle
    ? `${job.title} (${(job as RawJobData).original_title})`
    : job.title;
  parts.push(section("JOB", titleLine));

  // ── 2. Company and location ─────────────────────────────────────────────
  const country = COUNTRY_NAMES[job.country] ?? job.country;
  const companyLoc = joinNonEmpty([
    job.company || undefined,
    job.location || undefined,
    country,
  ]);
  if (companyLoc) {
    parts.push(section("COMPANY", companyLoc));
  }

  // ── 3. Hard requirements (critical matching signal) ─────────────────────
  const requirements = "hard_requirements" in job
    ? (job.hard_requirements ?? [])
    : [];
  if (Array.isArray(requirements) && requirements.length > 0) {
    parts.push(section("REQUIREMENTS", requirements as string[]));
  }

  // ── 4. Description (trimmed to avoid noise) ─────────────────────────────
  const description = job.description || "";
  if (description.length > 0) {
    // Take first ~3000 chars to keep the embedding focused.
    // Job descriptions often end with generic company info that dilutes matching.
    const trimmedDesc =
      description.length > 3000
        ? description.slice(0, 3000).trim() + "..."
        : description;
    parts.push(section("DESCRIPTION", trimmedDesc));
  }

  // ── 5. Salary info (level signal) ───────────────────────────────────────
  const salary = job.salary_info;
  if (salary && typeof salary === "object" && !Array.isArray(salary)) {
    const s = salary as Record<string, unknown>;
    const salaryParts: string[] = [];
    if (s["min"] || s["max"]) {
      const range = [s["min"], s["max"]].filter(Boolean).join("-");
      salaryParts.push(range.toString());
    }
    if (s["currency"]) salaryParts.push(String(s["currency"]));
    if (s["period"]) salaryParts.push(String(s["period"]));
    if (salaryParts.length > 0) {
      parts.push(section("SALARY", salaryParts.join(" ")));
    }
  }

  // ── 6. Country tag (explicit geographic signal) ─────────────────────────
  parts.push(section("COUNTRY", country));

  return parts.filter((p) => p.length > 0).join("\n");
}
