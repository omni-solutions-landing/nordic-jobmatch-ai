/**
 * Prerequisite matching — pure functions for comparing a job posting's hard
 * requirements against a parsed CV.
 *
 * Extracted from the match-actions Server Action so the logic is unit-testable
 * ("use server" modules may only export async functions).
 */

import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";

const LANGUAGE_MAP: Record<string, string[]> = {
  sv: ["svenska", "swedish", "svensk", "sv"],
  en: ["engelska", "english", "engelsk", "en"],
  no: ["norska", "norwegian", "norsk", "no"],
  da: ["danska", "danish", "dansk", "da"],
  fi: ["finska", "finnish", "finsk", "fi", "suomi"],
};

/**
 * Returns the subset of `hardRequirements` that the CV does not satisfy via
 * skills, certifications (incl. driver license class hierarchy), education,
 * or languages. Without structured data, all requirements are missing.
 */
export function checkMissingPrerequisites(
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

const REGULATED_TITLES = [
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

const REGULATED_REQUIREMENT_TERMS = [
  "legitimerad",
  "sjuksköterska",
  "optiker",
  "fagbrev",
  "hms-kort",
  "ykb",
  "körkort",
  "license",
];

/**
 * Applies credential-based score penalties to a raw similarity score:
 *  - Regulated job title without the matching credential in the CV → 0.
 *  - Missing a regulated requirement (license, safety card, …) → 0.
 *  - Other missing prerequisites → −0.15 each, floored at 0.
 */
export function adjustMatchScore(
  baseScore: number,
  jobTitle: string,
  structuredData: CvStructuredData | undefined,
  missingPrerequisites: string[],
): number {
  let adjustedScore = baseScore;

  const titleLower = jobTitle.toLowerCase();
  const cvTextLower = JSON.stringify(structuredData || {}).toLowerCase();
  const isRegulatedTitle = REGULATED_TITLES.some((term) =>
    titleLower.includes(term),
  );
  if (isRegulatedTitle) {
    const hasCredential = REGULATED_TITLES.some(
      (term) => titleLower.includes(term) && cvTextLower.includes(term),
    );
    if (!hasCredential) {
      adjustedScore = 0;
    }
  }

  if (adjustedScore > 0 && missingPrerequisites.length > 0) {
    const hasRegulatedRequirement = missingPrerequisites.some((req) => {
      const reqLower = req.toLowerCase();
      return REGULATED_REQUIREMENT_TERMS.some((term) =>
        reqLower.includes(term),
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

  return adjustedScore;
}
