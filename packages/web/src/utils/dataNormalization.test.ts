import { describe, it, expect } from "vitest";
import type { TimeRange } from "./dataNormalization";

describe("dataNormalization", () => {
  describe("TimeRange type", () => {
    it("accepts valid time range values", () => {
      const ranges: TimeRange[] = ["2weeks", "4weeks", "2months", "6months", "ytd"];
      expect(ranges).toHaveLength(5);
    });

    it("can be used as a type constraint", () => {
      const range: TimeRange = "2weeks";
      expect(range).toBe("2weeks");
    });
  });
});
