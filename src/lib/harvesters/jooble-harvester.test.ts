import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { joobleHarvester, type RawJoobleAd } from "./jooble-harvester";

// With GEMINI_API_KEY unset, extractUnstructuredData short-circuits to
// { hard_requirements: [], salary_info: {} } without any network call,
// making mapToSchema fully deterministic.
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Fixture modeled on a real jooble.org API response job (2026-06-10). */
const FIXTURE_AD: RawJoobleAd = {
  title: "Lastbilschaufför CE till fjärrtrafik",
  link: "https://jooble.org/desc/5819133325146684771",
  description:
    "Vi söker en erfaren CE-chaufför för fjärrtransporter. Krav: CE-körkort och YKB.",
  company: "Svea Transport AB",
  location: "Sweden",
  salary: "38 000 kr/månad",
  country: "SE",
};

describe("joobleHarvester.mapToSchema", () => {
  it("maps the fixture ad to a job_postings row", async () => {
    const result = await joobleHarvester.mapToSchema(FIXTURE_AD);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const row = result.value;
    expect(row.title).toBe("Lastbilschaufför CE till fjärrtrafik");
    expect(row.company).toBe("Svea Transport AB");
    expect(row.description).toContain("CE-chaufför");
    expect(row.location).toBe("Sweden");
    expect(row.country).toBe("SE");
    expect(row.source_url).toBe("https://jooble.org/desc/5819133325146684771");
    expect(row.source_platform).toBe("jooble");
    expect(row.expires_at).toBeTruthy();
  });

  it.each([
    ["SE", "sv"],
    ["NO", "no"],
    ["DK", "da"],
    ["FI", "fi"],
  ] as const)("sets original_language %s → %s", async (country, language) => {
    const result = await joobleHarvester.mapToSchema({
      ...FIXTURE_AD,
      country,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.country).toBe(country);
    expect(result.value.original_language).toBe(language);
  });

  it("falls back to a placeholder company and the country as location", async () => {
    const result = await joobleHarvester.mapToSchema({
      ...FIXTURE_AD,
      company: undefined,
      location: undefined,
      country: "FI",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.company).toBe("Jooble Partner");
    expect(result.value.location).toBe("FI");
  });

  it("uses Jooble's raw salary string when AI extraction yields nothing", async () => {
    const result = await joobleHarvester.mapToSchema(FIXTURE_AD);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.salary_info).toEqual({ raw: "38 000 kr/månad" });
  });

  it("leaves salary_info empty when the ad has no salary", async () => {
    const result = await joobleHarvester.mapToSchema({
      ...FIXTURE_AD,
      salary: undefined,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.salary_info).toEqual({});
  });
});

describe("joobleHarvester.fetchRaw", () => {
  it("skips gracefully (empty result, no network) when JOOBLE_API_KEY is unset", async () => {
    vi.stubEnv("JOOBLE_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await joobleHarvester.fetchRaw(20, 1440, "chaufför");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual([]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("JOOBLE_API_KEY"),
    );

    fetchSpy.mockRestore();
    warn.mockRestore();
  });
});
