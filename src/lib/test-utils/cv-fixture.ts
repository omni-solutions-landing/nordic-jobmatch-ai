/**
 * Test fixture builder for CvStructuredData.
 *
 * Produces a schema-valid CV (validated with CvStructuredDataSchema.parse so
 * fixtures can never drift from the real schema) with sensible Nordic-flavored
 * defaults. Override any top-level field via the partial argument.
 */

import {
  CvStructuredDataSchema,
  type CvStructuredData,
} from "@/lib/ai/cv-parser/schema";

const BASE_CV: CvStructuredData = {
  schema_version: "1.0",
  detected_languages: ["sv", "en"],
  professional_summary:
    "Experienced welder with 8 years in heavy industry across Sweden and Norway.",
  personal: {
    full_name: "Test Person",
    email: "test@example.com",
    phone: "+46701234567",
    linkedin_url: "",
    portfolio_url: "",
    location: {
      city: "Göteborg",
      region: "Västra Götaland",
      country_code: "SE",
    },
    date_of_birth: "",
    nationality: "Swedish",
    work_permit_status: "EU/EEA citizen",
    preferred_target_countries: ["SE", "NO"],
    preferred_target_regions: ["Oslo"],
    willing_to_relocate: true,
  },
  experiences: [
    {
      job_title: "Welder",
      job_title_original: "Svetsare",
      company: "Industri AB",
      industry: "Manufacturing",
      location: "Göteborg",
      country_code: "SE",
      start_date: "2018-03",
      end_date: "",
      is_current: true,
      description: "MIG/MAG welding of structural steel components.",
      key_achievements: ["Reduced weld defect rate by 30%."],
      technologies_and_tools: ["MIG/MAG", "TIG"],
    },
  ],
  education: [
    {
      degree: "Vocational Diploma",
      degree_original: "Yrkeshögskoleexamen",
      field_of_study: "Welding Technology",
      institution: "Yrkeshögskolan Göteborg",
      location: "Göteborg",
      country_code: "SE",
      start_date: "2015-08",
      end_date: "2017-06",
      is_completed: true,
      ects_credits: null,
      grade_or_distinction: "",
    },
  ],
  languages: [
    {
      language: "Swedish",
      iso_code: "sv",
      proficiency: "native",
      is_nordic: true,
    },
    {
      language: "English",
      iso_code: "en",
      proficiency: "professional",
      is_nordic: false,
    },
  ],
  certifications: [
    {
      name: "Svetskörkort",
      name_english: "Welding Certificate",
      issuing_authority: "Svetskommissionen",
      category: "welding_certification",
      nordic_code: "",
      license_classes: [],
      issue_date: "2017-06",
      expiry_date: "",
      country_of_issue: "SE",
      cross_border_validity: "Valid across EU/EEA",
    },
  ],
  skills: {
    technical: ["MIG/MAG welding", "TIG welding", "Blueprint reading"],
    soft: ["Teamwork", "Reliability"],
    tools_and_platforms: ["AutoCAD"],
    industry_specific: ["Cold climate construction"],
    machinery_and_equipment: ["Overhead crane"],
  },
  references_available: false,
  extraction_metadata: {
    overall_confidence: 0.95,
    ambiguous_sections: [],
    cv_quality_notes: "",
  },
};

/**
 * Returns a deep-cloned, schema-validated CV with the given top-level
 * overrides applied.
 */
export function makeCv(
  overrides: Partial<CvStructuredData> = {},
): CvStructuredData {
  return CvStructuredDataSchema.parse({
    ...structuredClone(BASE_CV),
    ...overrides,
  });
}
