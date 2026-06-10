import { describe, expect, it } from "vitest";
import {
  stringifyCvForEmbedding,
  stringifyJobForEmbedding,
  type RawJobData,
} from "./stringifiers";
import { makeCv } from "@/lib/test-utils/cv-fixture";

describe("stringifyCvForEmbedding", () => {
  const text = stringifyCvForEmbedding(makeCv());

  it("front-loads the professional summary", () => {
    expect(text.startsWith("PROFESSIONAL PROFILE:")).toBe(true);
    expect(text).toContain("Experienced welder");
  });

  it("expands target country codes to English names", () => {
    expect(text).toContain("TARGET COUNTRIES: Sweden, Norway");
  });

  it("merges all hard-skill categories into the SKILLS section", () => {
    const skillsLine = text
      .split("\n")
      .find((line) => line.startsWith("SKILLS:"));
    expect(skillsLine).toContain("MIG/MAG welding"); // technical
    expect(skillsLine).toContain("AutoCAD"); // tools_and_platforms
    expect(skillsLine).toContain("Cold climate construction"); // industry_specific
    expect(skillsLine).toContain("Overhead crane"); // machinery_and_equipment
    expect(skillsLine).not.toContain("Teamwork"); // soft skills live in their own section
  });

  it("keeps soft skills in a separate section", () => {
    expect(text).toContain("SOFT SKILLS: Teamwork, Reliability");
  });

  it("uses bilingual anchoring for experience titles", () => {
    expect(text).toContain("Welder (Svetsare)");
  });

  it("marks current roles with 'to present'", () => {
    expect(text).toContain("2018-03 to present");
  });

  it("uses bilingual anchoring for degrees", () => {
    expect(text).toContain("Vocational Diploma (Yrkeshögskoleexamen)");
    expect(text).toContain("in Welding Technology");
  });

  it("formats certifications with English name, category, and validity", () => {
    expect(text).toContain(
      "Welding Certificate (welding certification, Valid across EU/EEA)",
    );
  });

  it("includes license classes in certification strings", () => {
    const cv = makeCv({
      certifications: [
        {
          name: "Körkort",
          name_english: "Driver license",
          issuing_authority: "",
          category: "driver_license",
          nordic_code: "CE",
          license_classes: ["B", "C", "CE"],
          issue_date: "",
          expiry_date: "",
          country_of_issue: "SE",
          cross_border_validity: "Valid across EU/EEA",
        },
      ],
    });
    expect(stringifyCvForEmbedding(cv)).toContain(
      "CE — Driver license (driver license [B/C/CE], Valid across EU/EEA)",
    );
  });

  it("lists languages with proficiency", () => {
    expect(text).toContain("LANGUAGES: Swedish (native), English (professional)");
  });

  it("includes work authorization", () => {
    expect(text).toContain("WORK AUTHORIZATION: EU/EEA citizen");
  });

  it("omits sections whose source data is empty", () => {
    const cv = makeCv({
      professional_summary: "",
      certifications: [],
      languages: [],
    });
    const sparse = stringifyCvForEmbedding(cv);
    expect(sparse).not.toContain("PROFESSIONAL PROFILE:");
    expect(sparse).not.toContain("CERTIFICATIONS:");
    expect(sparse).not.toContain("LANGUAGES:");
  });
});

describe("stringifyJobForEmbedding", () => {
  const baseJob: RawJobData = {
    title: "Welder",
    original_title: "Sveiser",
    company: "Norsk Industri AS",
    description: "We are looking for an experienced welder.",
    location: "Bergen",
    country: "NO",
    hard_requirements: ["Fagbrev", "HMS-kort"],
    salary_info: {
      currency: "NOK",
      min: 250,
      max: 320,
      period: "hourly",
    },
  };

  it("uses bilingual anchoring when an original-language title differs", () => {
    expect(stringifyJobForEmbedding(baseJob)).toContain("JOB: Welder (Sveiser)");
  });

  it("does not duplicate the title when original matches the normalized one", () => {
    const job: RawJobData = { ...baseJob, original_title: "Welder" };
    expect(stringifyJobForEmbedding(job)).toContain("JOB: Welder\n");
  });

  it("renders company, location, and full country name", () => {
    expect(stringifyJobForEmbedding(baseJob)).toContain(
      "COMPANY: Norsk Industri AS | Bergen | Norway",
    );
  });

  it("lists hard requirements", () => {
    expect(stringifyJobForEmbedding(baseJob)).toContain(
      "REQUIREMENTS: Fagbrev, HMS-kort",
    );
  });

  it("formats salary range with currency and period", () => {
    expect(stringifyJobForEmbedding(baseJob)).toContain(
      "SALARY: 250-320 NOK hourly",
    );
  });

  it("appends an explicit country tag", () => {
    expect(stringifyJobForEmbedding(baseJob)).toContain("COUNTRY: Norway");
  });

  it("trims descriptions longer than 3000 characters", () => {
    const longDescription = "word ".repeat(1000); // 5000 chars
    const job: RawJobData = { ...baseJob, description: longDescription };
    const text = stringifyJobForEmbedding(job);
    const descLine = text
      .split("\n")
      .find((line) => line.startsWith("DESCRIPTION:"));
    expect(descLine).toBeDefined();
    expect(descLine!.length).toBeLessThan(3100);
    expect(descLine!.endsWith("...")).toBe(true);
  });

  it("omits description and salary sections when absent", () => {
    const job: RawJobData = {
      title: "Welder",
      description: "",
      country: "SE",
    };
    const text = stringifyJobForEmbedding(job);
    expect(text).not.toContain("DESCRIPTION:");
    expect(text).not.toContain("SALARY:");
  });
});
