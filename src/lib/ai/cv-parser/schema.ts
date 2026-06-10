/**
 * CV Parser — Zod Schema
 *
 * Defines the exact structure that Gemini must output when parsing a Nordic CV.
 * This schema is passed to Gemini's Structured Outputs (JSON-mode) via
 * `responseMimeType: "application/json"` + `responseSchema`.
 *
 * The inferred type `CvStructuredData` is what gets stored in
 * `cv_profiles.structured_data` (JSONB column).
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ─── Reusable Enums ──────────────────────────────────────────────────────────

export const NordicCountryCode = z.enum(["SE", "NO", "DK", "FI"]);
export type NordicCountryCode = z.infer<typeof NordicCountryCode>;

export const CountryCode = z.enum(["SE", "NO", "DK", "FI", "OTHER"]);
export type CountryCode = z.infer<typeof CountryCode>;

/** ISO 639-1 codes relevant to Nordic market + common extras */
export const LanguageIsoCode = z.enum([
  "sv", "no", "nb", "nn", "da", "fi", "en",
  "de", "fr", "es", "pl", "ar", "so", "ti", "fa", "uk", "ru",
]);

export const LanguageProficiency = z.enum([
  "native",
  "fluent",
  "professional",
  "intermediate",
  "basic",
]);

export const CertificationCategory = z.enum([
  "driver_license",           // B, BE, C, CE, D, DE, AM, A1, A2, A
  "professional_driver",      // YKB (SE), YSK (NO), Qualifying driver cert (DK/FI)
  "construction_safety",      // ID06 (SE), HMS-kort (NO), Arbejdsmiljø (DK), Valtti (FI)
  "infrastructure_safety",    // TMA, APV, Vägarbetare steg 1/2, Arbeid på veg
  "electrical_certification", // Elsäkerhet, Elektrikerbrev
  "welding_certification",    // Svetskörkort, IIW/EWF
  "maritime_certification",   // Sjöfartscertifikat, Båtförarbevis
  "healthcare_certification", // Legitimation (SE), Autorisasjon (NO)
  "food_safety",              // Hygienpass (SE), Matserveringsbevis
  "security_clearance",       // Säkerhetsprövning, Registerutdrag
  "forklift_crane",           // Truckförarintyg, Kranförarintyg, Maskinförarbevis
  "hot_work",                 // Heta arbeten / Varmt arbeid
  "first_aid",                // HLR, Första hjälpen, Førstehjelp
  "industry_certification",   // ISO auditor, PRINCE2, PMP, Scrum, ITIL
  "academic_credential",      // Degree equivalency, ENIC-NARIC recognition
  "other",
]);

// ─── Date format: YYYY-MM (normalized) ───────────────────────────────────────

/** Normalized date string in YYYY-MM format. Gemini is instructed to coerce. */
const YearMonthDate = z.string().describe(
  "Date in YYYY-MM format. If only the year is known, use YYYY-01. If unknown, use empty string."
);

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const PersonalInfoSchema = z.object({
  full_name: z.string().describe("Full legal name as written on the CV."),
  email: z.string().describe("Primary email address. Empty string if absent."),
  phone: z.string().describe("Phone number with country prefix if present. Empty string if absent."),
  linkedin_url: z.string().describe("LinkedIn profile URL. Empty string if absent."),
  portfolio_url: z.string().describe("Portfolio / personal website URL. Empty string if absent."),
  location: z.object({
    city: z.string().describe("City of residence. Empty string if not stated."),
    region: z.string().describe("Region/county/län/fylke. Empty string if not stated."),
    country_code: CountryCode.describe("ISO 3166-1 alpha-2 country code of current residence."),
  }),
  date_of_birth: z.string().describe("Date of birth in YYYY-MM-DD if present. Empty string if absent."),
  nationality: z.string().describe("Stated nationality. Empty string if absent."),
  work_permit_status: z.string().describe(
    "EU/EEA citizen, permanent resident, work permit holder, or unknown. " +
    "Infer from nationality/country if not stated explicitly."
  ),
  preferred_target_countries: z.array(NordicCountryCode).describe(
    "Countries the applicant has expressed interest in working in. " +
    "Infer from CV language, job history locations, and stated preferences."
  ),
  preferred_target_regions: z.array(z.string()).describe(
    "Specific regions/cities the applicant targets, e.g. 'Stockholm', 'Vestland', 'Hovedstaden'."
  ),
  willing_to_relocate: z.boolean().describe(
    "Whether the applicant indicates willingness to relocate. Default false if not stated."
  ),
});

const ExperienceSchema = z.object({
  job_title: z.string().describe("Normalized job title in English."),
  job_title_original: z.string().describe(
    "Job title exactly as written in the CV, preserving original language."
  ),
  company: z.string().describe("Company or organization name."),
  industry: z.string().describe(
    "Industry sector, e.g. 'Construction', 'IT', 'Healthcare', 'Logistics'. " +
    "Normalize to English."
  ),
  location: z.string().describe("City and/or region where the role was based."),
  country_code: CountryCode.describe("Country where the role was based."),
  start_date: YearMonthDate,
  end_date: YearMonthDate.describe(
    "End date in YYYY-MM format. Empty string if this is the current role."
  ),
  is_current: z.boolean().describe("True if this is the applicant's current role."),
  description: z.string().describe(
    "Concise summary of the role and responsibilities, in English."
  ),
  key_achievements: z.array(z.string()).describe(
    "Quantified achievements or key responsibilities, each as a single sentence in English."
  ),
  technologies_and_tools: z.array(z.string()).describe(
    "Specific technologies, tools, equipment, machinery, or software used in this role."
  ),
});

const EducationSchema = z.object({
  degree: z.string().describe(
    "Normalized degree name in English. Use standard equivalents: " +
    "'Kandidatexamen' → 'Bachelor\\'s Degree', 'Masterexamen' → 'Master\\'s Degree', " +
    "'Yrkeshögskola' → 'Vocational Diploma', 'Gymnasium' → 'Upper Secondary Diploma', " +
    "'Fagbrev' (NO) → 'Trade Certificate', 'Svend' (DK) → 'Journeyman\\'s Certificate'."
  ),
  degree_original: z.string().describe(
    "Degree name exactly as written on the CV, preserving original language."
  ),
  field_of_study: z.string().describe("Field or major in English."),
  institution: z.string().describe("Name of the educational institution."),
  location: z.string().describe("City/region of the institution."),
  country_code: CountryCode.describe("Country of the institution."),
  start_date: YearMonthDate,
  end_date: YearMonthDate.describe("Empty string if still ongoing."),
  is_completed: z.boolean().describe("True if the degree/program was completed."),
  ects_credits: z.number().nullable().describe(
    "ECTS credits if stated. null if not applicable or unknown."
  ),
  grade_or_distinction: z.string().describe(
    "Final grade, GPA, or distinction if stated. Empty string if absent."
  ),
});

const LanguageSchema = z.object({
  language: z.string().describe("Language name in English, e.g. 'Swedish', 'Norwegian Bokmål'."),
  iso_code: LanguageIsoCode.describe("ISO 639-1 code."),
  proficiency: LanguageProficiency.describe(
    "Proficiency level. Map CEFR: C2→native, C1→fluent, B2→professional, B1→intermediate, A1-A2→basic. " +
    "Map Nordic terms: 'modersmål'/'morsmål'→native, 'flytande'/'flytende'→fluent, " +
    "'goda kunskaper'/'gode kunnskaper'→professional."
  ),
  is_nordic: z.boolean().describe("True if this is Swedish, Norwegian, Danish, or Finnish."),
});

const CertificationSchema = z.object({
  name: z.string().describe(
    "Official certification name in the original language as stated on the CV."
  ),
  name_english: z.string().describe(
    "English translation or internationally recognized equivalent name."
  ),
  issuing_authority: z.string().describe(
    "Organization that issued the certification. Empty string if not stated."
  ),
  category: CertificationCategory,
  nordic_code: z.string().describe(
    "Standardized Nordic code or abbreviation if applicable. Examples: " +
    "'CE' (driver license class), 'YKB' (SE professional driver), 'YSK' (NO professional driver), " +
    "'ID06' (SE construction card), 'HMS-kort' (NO safety card), 'Valtti' (FI safety card), " +
    "'TMA' (traffic management), 'APV' (DK workplace assessment). " +
    "Empty string if no recognized Nordic code applies."
  ),
  license_classes: z.array(z.string()).describe(
    "Applicable license classes if this is a driver_license. E.g. ['B', 'C', 'CE']. " +
    "Empty array for non-driving certifications."
  ),
  issue_date: YearMonthDate.describe("Issue date. Empty string if unknown."),
  expiry_date: YearMonthDate.describe(
    "Expiry date. Empty string if no expiry or unknown."
  ),
  country_of_issue: CountryCode.describe("Country that issued the certification."),
  cross_border_validity: z.string().describe(
    "Notes on whether this certification is valid across Nordic countries. " +
    "E.g. 'Valid across EU/EEA' for driver licenses, or 'SE only' for ID06. " +
    "Empty string if unknown."
  ),
});

const SkillsSchema = z.object({
  technical: z.array(z.string()).describe(
    "Technical/hard skills: programming languages, frameworks, machinery operation, " +
    "engineering disciplines, medical procedures, etc."
  ),
  soft: z.array(z.string()).describe(
    "Soft skills: leadership, communication, teamwork, problem-solving, etc. " +
    "Normalize Nordic terms to English equivalents."
  ),
  tools_and_platforms: z.array(z.string()).describe(
    "Named tools, software, platforms, ERP systems, CAD programs, etc."
  ),
  industry_specific: z.array(z.string()).describe(
    "Domain-specific skills not covered above, e.g. 'Cold climate construction', " +
    "'Nordic public procurement (LOU/LOV)', 'GDPR compliance'."
  ),
  machinery_and_equipment: z.array(z.string()).describe(
    "Specific machinery, vehicles, or heavy equipment the applicant can operate. " +
    "E.g. 'Excavator', 'Reach truck', 'Overhead crane (traversal)', 'CNC lathe'."
  ),
});

// ─── Root Schema ─────────────────────────────────────────────────────────────

/**
 * Root schema for structured CV data.
 *
 * This is the exact shape stored in `cv_profiles.structured_data` (JSONB)
 * and the schema passed to Gemini's structured output mode.
 */
export const CvStructuredDataSchema = z.object({
  /** Schema version for future migrations of the JSONB structure. */
  schema_version: z.literal("1.0"),

  /** Detected source language(s) of the CV document. */
  detected_languages: z.array(LanguageIsoCode).describe(
    "ISO 639-1 codes of languages detected in the CV text. " +
    "A bilingual SE/EN CV should return ['sv', 'en']."
  ),

  /** Professional summary / personal statement, translated to English. */
  professional_summary: z.string().describe(
    "The applicant's professional summary or objective statement, translated to English. " +
    "If none is explicitly written, synthesize a 2-3 sentence summary from the CV content."
  ),

  personal: PersonalInfoSchema,
  experiences: z.array(ExperienceSchema).describe(
    "Work experience entries, ordered from most recent to oldest."
  ),
  education: z.array(EducationSchema).describe(
    "Education entries, ordered from most recent to oldest."
  ),
  languages: z.array(LanguageSchema).describe(
    "Language proficiencies. Always include Swedish, Norwegian, Danish, Finnish, and English " +
    "even if not mentioned — mark unmentioned Nordic languages as 'basic' only if the " +
    "applicant's native language is another Scandinavian language (mutual intelligibility), " +
    "otherwise omit them."
  ),
  certifications: z.array(CertificationSchema).describe(
    "All professional certifications, licenses, and registrations. " +
    "Pay special attention to Nordic-specific credentials."
  ),
  skills: SkillsSchema,
  references_available: z.boolean().describe(
    "True if the CV states that references are available upon request."
  ),

  /** Parser confidence and metadata */
  extraction_metadata: z.object({
    overall_confidence: z.number().min(0).max(1).describe(
      "Overall confidence score [0.0–1.0] that the extraction is accurate. " +
      "Lower the score if the CV is poorly formatted, multilingual with ambiguity, " +
      "or has sections that could not be reliably parsed."
    ),
    ambiguous_sections: z.array(z.string()).describe(
      "List of section names where the parser had low confidence, " +
      "e.g. 'certifications', 'experience[2].dates'. Empty array if fully confident."
    ),
    cv_quality_notes: z.string().describe(
      "Brief notes on CV quality: formatting issues, missing sections, " +
      "unusual structure, or anything the matching engine should be aware of."
    ),
  }),
});

/** The inferred TypeScript type — this is what lives in cv_profiles.structured_data */
export type CvStructuredData = z.infer<typeof CvStructuredDataSchema>;

/**
 * Converts the Zod schema to a JSON Schema object compatible with
 * Gemini's `responseSchema` parameter.
 *
 * Usage:
 *   import { cvJsonSchema } from "./schema";
 *   const result = await model.generateContent({
 *     ...
 *     generationConfig: {
 *       responseMimeType: "application/json",
 *       responseSchema: cvJsonSchema,
 *     },
 *   });
 */
export function zodToGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  // Gemini's responseSchema accepts a subset of JSON Schema.
  // We use zod-to-json-schema for conversion, then strip unsupported keys.
  const jsonSchema = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none", // Inline all refs — Gemini doesn't support $ref
  });

  // Helper to recursively strip keys not supported by Gemini responseSchema
  // (specifically "additionalProperties")
  function cleanSchema(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(cleanSchema);
    }

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "additionalProperties") {
        continue;
      }
      cleaned[key] = cleanSchema(value);
    }
    return cleaned;
  }

  return cleanSchema(jsonSchema) as Record<string, unknown>;
}
