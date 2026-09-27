import { beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_STORAGE_PREFIX,
  demoConfigKey,
  moveLegacyDemoStorage,
  saveDemoSection,
} from "./demoStorage";

const snapshot = () =>
  Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).map((key) => [
      key,
      localStorage.getItem(key),
    ])
  );

describe("demo storage", () => {
  beforeEach(() => localStorage.clear());

  it("keeps every section under the demo prefix", () => {
    expect(demoConfigKey("goals", 2026, "cycling")).toBe("demo.goals.2026.cycling");
    expect(demoConfigKey("annotations", 2026)).toBe("demo.annotations.2026");
    expect(demoConfigKey("preferences")).toBe("demo.preferences");
    for (const key of [demoConfigKey("goals", 2026, "run"), demoConfigKey("preferences")]) {
      expect(key.startsWith(DEMO_STORAGE_PREFIX)).toBe(true);
    }
  });

  it("saves a section as JSON under its key", () => {
    saveDemoSection("goals", { goals: [], storageVersion: 2 }, 2026, "cycling");
    expect(JSON.parse(localStorage.getItem("demo.goals.2026.cycling")!)).toEqual({
      goals: [],
      storageVersion: 2,
    });
  });

  describe("moving the keys used before the namespace", () => {
    it("moves each old key to its new one and removes it", () => {
      localStorage.setItem("demo_goals_virtual_ride_2026", "page goals");
      localStorage.setItem("userConfig_anonymous_preferences", "prefs");
      localStorage.setItem("userConfig_anonymous_annotations_2026", "notes");

      moveLegacyDemoStorage();

      expect(snapshot()).toEqual({
        "demo.goals.2026.virtual_ride": "page goals",
        "demo.preferences": "prefs",
        "demo.annotations.2026": "notes",
      });
    });

    it("prefers the demo page's goals to the hook's old demo key", () => {
      localStorage.setItem("userConfig_anonymous_goals_2026_cycling", "hook goals");
      localStorage.setItem("demo_goals_cycling_2026", "page goals");

      moveLegacyDemoStorage();

      expect(snapshot()).toEqual({ "demo.goals.2026.cycling": "page goals" });
    });

    it("never overwrites an entry already in the namespace", () => {
      localStorage.setItem("demo.preferences", "newer");
      localStorage.setItem("userConfig_anonymous_preferences", "older");

      moveLegacyDemoStorage();

      expect(snapshot()).toEqual({ "demo.preferences": "newer" });
    });

    it("leaves keys that aren't the demo's alone, and does nothing the second time", () => {
      localStorage.setItem("theme", "arcade");
      localStorage.setItem("sidebar-sections", "{}");
      localStorage.setItem("userConfig_anonymous_preferences", "prefs");

      moveLegacyDemoStorage();
      const once = snapshot();
      moveLegacyDemoStorage();

      expect(snapshot()).toEqual(once);
      expect(once).toEqual({
        theme: "arcade",
        "sidebar-sections": "{}",
        "demo.preferences": "prefs",
      });
    });

    it("does nothing when storage is unavailable", () => {
      const broken = {
        get length(): number {
          throw new Error("SecurityError");
        },
      } as unknown as Storage;
      expect(() => moveLegacyDemoStorage(broken)).not.toThrow();
    });
  });
});
