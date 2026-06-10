import { describe, expect, it } from "vitest";
import { adjustMatchScore, checkMissingPrerequisites } from "./prerequisites";
import { makeCv } from "@/lib/test-utils/cv-fixture";

function makeCvWithLicenseClasses(classes: string[]) {
  return makeCv({
    certifications: [
      {
        name: "Körkort",
        name_english: "Driver license",
        issuing_authority: "Transportstyrelsen",
        category: "driver_license",
        nordic_code: "",
        license_classes: classes,
        issue_date: "2015-01",
        expiry_date: "",
        country_of_issue: "SE",
        cross_border_validity: "Valid across EU/EEA",
      },
    ],
  });
}

describe("checkMissingPrerequisites", () => {
  it("returns all requirements when no structured data is available", () => {
    const reqs = ["CE", "YKB"];
    const missing = checkMissingPrerequisites(reqs);
    expect(missing).toEqual(["CE", "YKB"]);
    expect(missing).not.toBe(reqs); // defensive copy, not the same array
  });

  it("returns an empty array when there are no requirements", () => {
    expect(checkMissingPrerequisites([], makeCv())).toEqual([]);
  });

  it("skips blank requirement strings", () => {
    expect(checkMissingPrerequisites(["", "   "], makeCv())).toEqual([]);
  });

  it("matches requirements against skills case-insensitively", () => {
    const cv = makeCv();
    expect(checkMissingPrerequisites(["tig welding"], cv)).toEqual([]);
    expect(checkMissingPrerequisites(["TEAMWORK"], cv)).toEqual([]);
  });

  it("matches via bidirectional substring against skills", () => {
    const cv = makeCv();
    // requirement is a substring of the skill "MIG/MAG welding"
    expect(checkMissingPrerequisites(["welding"], cv)).toEqual([]);
    // skill "Overhead crane" (machinery_and_equipment) matches exactly
    expect(checkMissingPrerequisites(["Overhead crane"], cv)).toEqual([]);
  });

  it("matches certifications by name", () => {
    const cv = makeCv();
    expect(checkMissingPrerequisites(["Svetskörkort"], cv)).toEqual([]);
  });

  it("matches certifications by nordic code", () => {
    const cv = makeCv({
      certifications: [
        {
          name: "Yrkeskompetensbevis",
          name_english: "Professional driver qualification",
          issuing_authority: "",
          category: "professional_driver",
          nordic_code: "YKB",
          license_classes: [],
          issue_date: "",
          expiry_date: "",
          country_of_issue: "SE",
          cross_border_validity: "",
        },
      ],
    });
    expect(checkMissingPrerequisites(["YKB"], cv)).toEqual([]);
  });

  it("matches education by degree and field of study", () => {
    const cv = makeCv();
    expect(checkMissingPrerequisites(["Vocational Diploma"], cv)).toEqual([]);
    expect(checkMissingPrerequisites(["Welding Technology"], cv)).toEqual([]);
  });

  it("matches language requirements through the language equivalence map", () => {
    const cv = makeCv(); // Swedish (sv) + English (en)
    expect(checkMissingPrerequisites(["Svenska"], cv)).toEqual([]);
    expect(checkMissingPrerequisites(["Engelska"], cv)).toEqual([]);
    expect(checkMissingPrerequisites(["Finska"], cv)).toEqual(["Finska"]);
  });

  it("matches language equivalents only as whole words, not substrings", () => {
    const cv = makeCv(); // English (en) — "en" must not match inside words
    // regression: "Hygienpass" contains the substring "en"
    expect(checkMissingPrerequisites(["Hygienpass"], cv)).toEqual([
      "Hygienpass",
    ]);
    // but a real phrase containing the language as a word still matches
    expect(
      checkMissingPrerequisites(["Flytande svenska i tal och skrift"], cv),
    ).toEqual([]);
  });

  it("reports requirements not covered anywhere in the CV", () => {
    const cv = makeCv();
    expect(
      checkMissingPrerequisites(["Truckkort", "Hygienpass", "Excavator"], cv),
    ).toEqual(["Truckkort", "Hygienpass", "Excavator"]);
  });

  describe("driver license class hierarchy", () => {
    it("CE requirement is satisfied only by a CE class", () => {
      expect(
        checkMissingPrerequisites(
          ["CE-körkort"],
          makeCvWithLicenseClasses(["ce"]),
        ),
      ).toEqual([]);
      expect(
        checkMissingPrerequisites(
          ["CE-körkort"],
          makeCvWithLicenseClasses(["c"]),
        ),
      ).toEqual(["CE-körkort"]);
    });

    it("C requirement is satisfied by C or CE", () => {
      expect(
        checkMissingPrerequisites(
          ["Körkort klass C"],
          makeCvWithLicenseClasses(["c"]),
        ),
      ).toEqual([]);
      expect(
        checkMissingPrerequisites(
          ["Körkort klass C"],
          makeCvWithLicenseClasses(["ce"]),
        ),
      ).toEqual([]);
      expect(
        checkMissingPrerequisites(
          ["Körkort klass C"],
          makeCvWithLicenseClasses(["b"]),
        ),
      ).toEqual(["Körkort klass C"]);
    });

    it("B requirement is satisfied by B, C, or CE (higher classes include B)", () => {
      expect(
        checkMissingPrerequisites(
          ["B-körkort"],
          makeCvWithLicenseClasses(["ce"]),
        ),
      ).toEqual([]);
      expect(
        checkMissingPrerequisites(
          ["B-körkort"],
          makeCvWithLicenseClasses(["b"]),
        ),
      ).toEqual([]);
    });

    it("does not read a CE class out of the word 'license' (substring regression)", () => {
      // "license" contains the substring "ce" — it must be treated as a
      // generic license requirement, satisfied by any class, not as CE.
      expect(
        checkMissingPrerequisites(
          ["Valid driver's license"],
          makeCvWithLicenseClasses(["b"]),
        ),
      ).toEqual([]);
      // still missing when no license is held at all
      expect(
        checkMissingPrerequisites(
          ["Valid driver's license"],
          makeCv({ certifications: [] }),
        ),
      ).toEqual(["Valid driver's license"]);
    });

    it("recognizes CE written as separate or hyphenated tokens", () => {
      expect(
        checkMissingPrerequisites(
          ["Körkort C-E"],
          makeCvWithLicenseClasses(["ce"]),
        ),
      ).toEqual([]);
      expect(
        checkMissingPrerequisites(
          ["Körkort C-E"],
          makeCvWithLicenseClasses(["c"]),
        ),
      ).toEqual(["Körkort C-E"]);
    });

    it("a generic license requirement is satisfied by holding any license", () => {
      expect(
        checkMissingPrerequisites(["körkort"], makeCvWithLicenseClasses(["b"])),
      ).toEqual([]);
      // no license at all → requirement stays missing
      // (certifications cleared: the fixture's "Svetskörkort" cert name
      // would otherwise satisfy the requirement via substring match)
      expect(
        checkMissingPrerequisites(["körkort"], makeCv({ certifications: [] })),
      ).toEqual(["körkort"]);
    });
  });
});

describe("adjustMatchScore", () => {
  it("returns the base score when nothing is missing and the title is unregulated", () => {
    expect(adjustMatchScore(0.8, "Lagerarbetare", makeCv(), [])).toBe(0.8);
  });

  it("subtracts 0.15 per missing non-regulated prerequisite", () => {
    const score = adjustMatchScore(0.8, "Lagerarbetare", makeCv(), [
      "Hygienpass",
      "Excavator",
    ]);
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("floors the penalized score at 0", () => {
    const score = adjustMatchScore(0.2, "Lagerarbetare", makeCv(), [
      "Hygienpass",
      "Excavator",
    ]);
    expect(score).toBe(0);
  });

  it("zeroes the score when a regulated requirement is missing", () => {
    expect(adjustMatchScore(0.9, "Lagerarbetare", makeCv(), ["YKB"])).toBe(0);
    expect(
      adjustMatchScore(0.9, "Lagerarbetare", makeCv(), ["CE-körkort"]),
    ).toBe(0);
  });

  it("zeroes the score for a regulated job title without the credential in the CV", () => {
    expect(
      adjustMatchScore(0.9, "Legitimerad Sjuksköterska", makeCv(), []),
    ).toBe(0);
  });

  it("keeps the score for a regulated title when the CV mentions the credential", () => {
    const nurseCv = makeCv({
      professional_summary: "Legitimerad sjuksköterska med 10 års erfarenhet.",
    });
    expect(
      adjustMatchScore(0.9, "Legitimerad Sjuksköterska", nurseCv, []),
    ).toBe(0.9);
  });

  it("treats missing structured data as having no credentials", () => {
    expect(adjustMatchScore(0.9, "Sykepleier", undefined, [])).toBe(0);
  });
});
