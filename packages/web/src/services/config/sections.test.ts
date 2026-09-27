import { describe, it, expect } from "vitest";
import { selectSection, toSectionRef, withSection } from "./sections";
import type { GoalsForYear, UserConfig } from "../userConfigService";
import { DEFAULT_PREFERENCES } from "../../constants/settings";

const goals = (id: string): GoalsForYear => ({
  goals: [{ id, value: 1000, label: id, createdAt: "", updatedAt: "", metric: "distance_meters" }],
  storageVersion: 2,
});

const DOC: UserConfig = {
  schemaVersion: "2.1",
  userId: "u1",
  lastUpdated: "2026-01-01T00:00:00Z",
  preferences: { ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" },
  goals: {
    "2026": { sports: { cycling: goals("cycling"), running: goals("running") } },
    "2025": { sports: { cycling: goals("old") } },
  },
  annotations: { "2026": { annotations: [] } },
};

describe("toSectionRef", () => {
  it("names each section, and none when its year or sport is missing", () => {
    expect(toSectionRef("preferences")).toEqual({ section: "preferences" });
    expect(toSectionRef("annotations", 2026)).toEqual({ section: "annotations", year: 2026 });
    expect(toSectionRef("goals", 2026, "cycling")).toEqual({
      section: "goals",
      year: 2026,
      sport: "cycling",
    });
    expect(toSectionRef("goals", 2026)).toBeNull();
    expect(toSectionRef("annotations")).toBeNull();
  });
});

describe("selectSection", () => {
  it("reads each section from the document", () => {
    expect(selectSection(DOC, { section: "preferences" })?.distanceUnit).toBe("kilometers");
    expect(selectSection(DOC, { section: "goals", year: 2026, sport: "running" })).toEqual(
      goals("running")
    );
    expect(selectSection(DOC, { section: "annotations", year: 2026 })).toEqual({
      annotations: [],
    });
  });

  it("is null for a section with nothing saved, or no document", () => {
    expect(selectSection(DOC, { section: "goals", year: 2026, sport: "yoga" })).toBeNull();
    expect(selectSection(DOC, { section: "goals", year: 2024, sport: "cycling" })).toBeNull();
    expect(selectSection(DOC, { section: "annotations", year: 2025 })).toBeNull();
    expect(selectSection(null, { section: "preferences" })).toBeNull();
    expect(selectSection(undefined, { section: "preferences" })).toBeNull();
  });
});

describe("withSection", () => {
  const cycling2026 = { section: "goals", year: 2026, sport: "cycling" } as const;

  it("sets one section and leaves every other as it was", () => {
    const next = withSection(DOC, cycling2026, goals("new"));

    expect(selectSection(next, cycling2026)).toEqual(goals("new"));
    expect(next.goals["2026"]!.sports.running).toBe(DOC.goals["2026"]!.sports.running);
    expect(next.goals["2025"]).toBe(DOC.goals["2025"]);
    expect(next.preferences).toBe(DOC.preferences);
    expect(next.annotations).toBe(DOC.annotations);
  });

  it("takes out only that section when set to null, as a rollback of a first save does", () => {
    const next = withSection(DOC, cycling2026, null);

    expect(selectSection(next, cycling2026)).toBeNull();
    expect(selectSection(next, { section: "goals", year: 2026, sport: "running" })).toEqual(
      goals("running")
    );
    expect(selectSection(withSection(DOC, { section: "preferences" }, null), cycling2026)).toEqual(
      goals("cycling")
    );
    expect(withSection(DOC, { section: "annotations", year: 2026 }, null).annotations).toEqual({});
  });

  it("leaves the document it was given alone", () => {
    const before = structuredClone(DOC);
    withSection(DOC, cycling2026, goals("new"));
    withSection(DOC, { section: "preferences" }, null);
    expect(DOC).toEqual(before);
  });

  it("starts a document for a first save", () => {
    const next = withSection(null, { section: "annotations", year: 2026 }, { annotations: [] });
    expect(selectSection(next, { section: "annotations", year: 2026 })).toEqual({
      annotations: [],
    });
    expect(selectSection(next, { section: "preferences" })).toBeNull();
  });
});
