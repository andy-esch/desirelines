import { describe, it, expect } from "vitest";
import { sourceHref, viewOnSourceLabel } from "./activitySource";

describe("viewOnSourceLabel", () => {
  it("names a known source", () => {
    expect(viewOnSourceLabel("strava")).toBe("View on Strava");
  });

  it("shows an unknown source by its raw name", () => {
    expect(viewOnSourceLabel("garmin")).toBe("View on garmin");
  });

  it("falls back to a neutral label when the source is missing", () => {
    expect(viewOnSourceLabel("")).toBe("View original activity");
    expect(viewOnSourceLabel(undefined)).toBe("View original activity");
  });
});

describe("sourceHref", () => {
  it("passes an https URL through unchanged", () => {
    expect(sourceHref("https://www.strava.com/activities/123")).toBe(
      "https://www.strava.com/activities/123"
    );
  });

  it.each([
    ["empty", ""],
    ["missing", undefined],
    ["not a URL", "strava.com/activities/123"],
    ["plain http", "http://www.strava.com/activities/123"],
    ["javascript scheme", "javascript:alert(1)"],
  ])("refuses a %s URL", (_label, url) => {
    expect(sourceHref(url)).toBeUndefined();
  });
});
