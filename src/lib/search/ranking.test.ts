import { describe, expect, it } from "vitest";
import { rankSearchResults } from "./ranking";

const job = (
  country: string,
  similarity: number | null,
  created_at = "2026-06-01T00:00:00Z",
) => ({ country, similarity, created_at });

describe("rankSearchResults", () => {
  it("orders cross-border results SE > FI > NO > DK before relevance", () => {
    const results = rankSearchResults(
      [job("DK", 0.95), job("NO", 0.9), job("SE", 0.55), job("FI", 0.8)],
      { applyCountryPriority: true, limit: 10 },
    );
    expect(results.map((r) => r.country)).toEqual(["SE", "FI", "NO", "DK"]);
  });

  it("ranks by similarity within the same country", () => {
    const results = rankSearchResults(
      [job("SE", 0.6), job("SE", 0.9), job("SE", 0.75)],
      { applyCountryPriority: true, limit: 10 },
    );
    expect(results.map((r) => r.similarity)).toEqual([0.9, 0.75, 0.6]);
  });

  it("skips country priority for country-specific searches", () => {
    const results = rankSearchResults(
      [job("DK", 0.95), job("DK", 0.6), job("DK", 0.8)],
      { applyCountryPriority: false, limit: 10 },
    );
    expect(results.map((r) => r.similarity)).toEqual([0.95, 0.8, 0.6]);
  });

  it("truncates to the requested limit AFTER ranking", () => {
    const results = rankSearchResults(
      [job("DK", 0.99), job("SE", 0.55), job("FI", 0.7)],
      { applyCountryPriority: true, limit: 2 },
    );
    // top-2 by priority order, not by raw similarity
    expect(results.map((r) => r.country)).toEqual(["SE", "FI"]);
  });

  it("falls back to newest-first when similarity is null (browse mode)", () => {
    const results = rankSearchResults(
      [
        job("SE", null, "2026-06-01T00:00:00Z"),
        job("SE", null, "2026-06-09T00:00:00Z"),
        job("SE", null, "2026-06-05T00:00:00Z"),
      ],
      { applyCountryPriority: true, limit: 10 },
    );
    expect(results.map((r) => r.created_at)).toEqual([
      "2026-06-09T00:00:00Z",
      "2026-06-05T00:00:00Z",
      "2026-06-01T00:00:00Z",
    ]);
  });

  it("places unknown countries last", () => {
    const results = rankSearchResults(
      [job("XX", 0.99), job("DK", 0.5)],
      { applyCountryPriority: true, limit: 10 },
    );
    expect(results.map((r) => r.country)).toEqual(["DK", "XX"]);
  });

  it("does not mutate the input array", () => {
    const input = [job("DK", 0.9), job("SE", 0.5)];
    const copy = [...input];
    rankSearchResults(input, { applyCountryPriority: true, limit: 10 });
    expect(input).toEqual(copy);
  });
});
