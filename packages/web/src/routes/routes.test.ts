import { describe, it, expect } from "vitest";
import { validateRoutesSearch } from "./routes";

describe("validateRoutesSearch", () => {
  it("coerces a positive activity id (string from the URL, or number)", () => {
    expect(validateRoutesSearch({ activity: "12345" })).toEqual({ activity: 12345 });
    expect(validateRoutesSearch({ activity: 678 })).toEqual({ activity: 678 });
  });

  it("drops a missing / non-numeric / non-positive / non-integer id", () => {
    expect(validateRoutesSearch({})).toEqual({});
    expect(validateRoutesSearch({ activity: "abc" })).toEqual({});
    expect(validateRoutesSearch({ activity: -5 })).toEqual({});
    expect(validateRoutesSearch({ activity: 0 })).toEqual({});
    expect(validateRoutesSearch({ activity: 1.5 })).toEqual({});
  });
});
