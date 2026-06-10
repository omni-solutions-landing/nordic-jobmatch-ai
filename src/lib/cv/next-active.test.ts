import { describe, expect, it } from "vitest";
import { pickNextActiveCv } from "./next-active";

describe("pickNextActiveCv", () => {
  it("returns null when no candidates remain", () => {
    expect(pickNextActiveCv([])).toBeNull();
  });

  it("returns the only candidate", () => {
    const only = { id: "a", updated_at: "2026-06-01T10:00:00Z" };
    expect(pickNextActiveCv([only])).toBe(only);
  });

  it("picks the most recently updated candidate", () => {
    const older = { id: "old", updated_at: "2026-05-01T10:00:00Z" };
    const newest = { id: "new", updated_at: "2026-06-10T08:00:00Z" };
    const middle = { id: "mid", updated_at: "2026-06-01T10:00:00Z" };
    expect(pickNextActiveCv([older, newest, middle])).toBe(newest);
    // order-independent
    expect(pickNextActiveCv([newest, older, middle])).toBe(newest);
  });

  it("keeps the first candidate when timestamps are equal", () => {
    const first = { id: "first", updated_at: "2026-06-01T10:00:00Z" };
    const second = { id: "second", updated_at: "2026-06-01T10:00:00Z" };
    expect(pickNextActiveCv([first, second])).toBe(first);
  });

  it("falls back to the first candidate when timestamps are unparsable", () => {
    const a = { id: "a", updated_at: "not-a-date" };
    const b = { id: "b", updated_at: "also-not-a-date" };
    expect(pickNextActiveCv([a, b])).toBe(a);
  });
});
