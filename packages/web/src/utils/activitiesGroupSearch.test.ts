import { describe, it, expect } from "vitest";
import { forwardActivitiesGroupSearch } from "./activitiesGroupSearch";

describe("forwardActivitiesGroupSearch", () => {
  it("carries range + sports between List and Charts", () => {
    expect(forwardActivitiesGroupSearch("/charts", { range: "6m", sports: "cycling" })).toEqual({
      range: "6m",
      sports: "cycling",
    });
    expect(forwardActivitiesGroupSearch("/activities", { range: "6m", sports: "cycling" })).toEqual(
      {
        range: "6m",
        sports: "cycling",
      }
    );
  });

  it("passes sports straight through to the map (shared param, no rename)", () => {
    expect(forwardActivitiesGroupSearch("/routes", { sports: "running" })).toEqual({
      sports: "running",
    });
    expect(forwardActivitiesGroupSearch("/charts", { sports: "running" })).toEqual({
      sports: "running",
    });
  });

  it("passes a multi-sport selection through unchanged", () => {
    expect(forwardActivitiesGroupSearch("/charts", { sports: "running,cycling" })).toEqual({
      sports: "running,cycling",
    });
  });

  it("does not carry the range preset onto the map (no time equivalent)", () => {
    expect(forwardActivitiesGroupSearch("/routes", { sports: "cycling", range: "6m" })).toEqual({
      sports: "cycling",
    });
  });

  it("does not carry the map's date/distance/region onto Charts (no lingering)", () => {
    expect(
      forwardActivitiesGroupSearch("/charts", { sports: "running", from: "2026-01-01", region: 5 })
    ).toEqual({ sports: "running" });
  });

  it("keeps the map's own params when staying within the map model", () => {
    expect(
      forwardActivitiesGroupSearch("/routes", { sports: "running", from: "2026-01-01", region: 5 })
    ).toEqual({ sports: "running", from: "2026-01-01", region: 5 });
  });

  it("returns nothing when no filter is active", () => {
    expect(forwardActivitiesGroupSearch("/charts", {})).toEqual({});
    expect(forwardActivitiesGroupSearch("/routes", {})).toEqual({});
  });
});
