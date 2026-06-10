import { describe, expect, it } from "vitest";
import { fail, flatMap, fromPromise, map, ok, type Result } from "./result";

describe("ok / fail", () => {
  it("ok wraps a value in a success result", () => {
    const result = ok(42);
    expect(result).toEqual({ success: true, value: 42 });
  });

  it("fail wraps an error in a failure result", () => {
    const error = new Error("boom");
    const result = fail(error);
    expect(result).toEqual({ success: false, error });
  });

  it("supports custom error types", () => {
    const result: Result<number, string> = fail("not found");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("not found");
    }
  });
});

describe("map", () => {
  it("transforms the value of a success", () => {
    const result = map(ok(2), (n) => n * 10);
    expect(result).toEqual({ success: true, value: 20 });
  });

  it("passes a failure through untouched", () => {
    const failure: Result<number, string> = fail("nope");
    const result = map(failure, (n) => n * 10);
    expect(result).toBe(failure);
  });

  it("can change the value type", () => {
    const result = map(ok(2), (n) => `value: ${n}`);
    expect(result).toEqual({ success: true, value: "value: 2" });
  });
});

describe("flatMap", () => {
  const parsePositive = (n: number): Result<number, string> =>
    n > 0 ? ok(n) : fail("not positive");

  it("chains a success into the next computation", () => {
    expect(flatMap(ok<number, string>(5), parsePositive)).toEqual({
      success: true,
      value: 5,
    });
  });

  it("returns the failure produced by the chained function", () => {
    expect(flatMap(ok<number, string>(-1), parsePositive)).toEqual({
      success: false,
      error: "not positive",
    });
  });

  it("short-circuits on an initial failure without calling fn", () => {
    const failure: Result<number, string> = fail("upstream");
    let called = false;
    const result = flatMap(failure, (n) => {
      called = true;
      return parsePositive(n);
    });
    expect(result).toBe(failure);
    expect(called).toBe(false);
  });
});

describe("fromPromise", () => {
  it("wraps a resolved promise in a success", async () => {
    const result = await fromPromise(Promise.resolve("done"));
    expect(result).toEqual({ success: true, value: "done" });
  });

  it("wraps a rejected Error in a failure", async () => {
    const error = new Error("rejected");
    const result = await fromPromise(Promise.reject(error));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(error);
    }
  });

  it("converts non-Error rejections into Error instances", async () => {
    const result = await fromPromise(Promise.reject("string reason"));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe("string reason");
    }
  });
});
