import { describe, it, expect, vi, afterEach } from "vitest";
import { generateActivityName } from "./activityNameGenerator";

describe("generateActivityName", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("returns a non-empty string", () => {
    const sports = ["cycling", "running", "yoga", "hiking", "workout", "unknown_sport"];
    const hours = [6, 9, 12, 15, 19];

    for (const sport of sports) {
      for (const hour of hours) {
        it(`for sport="${sport}" hour=${hour}`, () => {
          const name = generateActivityName(sport, hour);
          expect(typeof name).toBe("string");
          expect(name.length).toBeGreaterThan(0);
        });
      }
    }
  });

  describe("time-of-day awareness", () => {
    it("uses morning prefixes for hours 6-10", () => {
      // Force the 60% time-of-day path (roll >= 0.40)
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("cycling", 7);
      // Should contain a morning prefix
      expect(name).toMatch(/^(Morning|Early Morning|Sunrise|Dawn) /);
    });

    it("uses lunch prefixes for hours 11-12", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("cycling", 12);
      expect(name).toMatch(/^(Lunch|Midday|Noon) /);
    });

    it("uses afternoon prefixes for hours 13-16", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("cycling", 15);
      expect(name).toMatch(/^(Afternoon|Post-Lunch) /);
    });

    it("uses evening prefixes for hours 17-20", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("cycling", 19);
      expect(name).toMatch(/^(Evening|Sunset|Twilight) /);
    });

    it("treats hours outside 6-20 as evening", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("running", 3);
      expect(name).toMatch(/^(Evening|Sunset|Twilight) /);
    });
  });

  describe("sport-specific names", () => {
    it("uses cycling suffixes for cycling", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("cycling", 8);
      expect(name).toMatch(/(Ride|Spin|Loop|Cruise|Pedal)$/);
    });

    it("uses running suffixes for running", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("running", 8);
      expect(name).toMatch(/(Run|Jog|Miles|Stride)$/);
    });

    it("uses yoga suffixes for yoga", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("yoga", 8);
      expect(name).toMatch(/(Flow|Practice|Session|Stretch)$/);
    });

    it("uses hiking suffixes for hiking", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("hiking", 8);
      expect(name).toMatch(/(Hike|Trek|Walk|Ramble)$/);
    });

    it("uses workout suffixes for workout", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("workout", 8);
      expect(name).toMatch(/(Workout|Session|Training|Pump)$/);
    });
  });

  describe("unknown/dynamic sports", () => {
    it("falls back to generic suffixes", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("skateboarding", 8);
      expect(name).toMatch(/(Session|Activity|Workout)$/);
    });

    it("still generates creative names", () => {
      // Force creative path (roll between 0.05 and 0.40)
      vi.spyOn(Math, "random").mockReturnValue(0.2);
      const name = generateActivityName("skateboarding", 8);
      expect(name.length).toBeGreaterThan(0);
    });
  });

  describe("weighted distribution", () => {
    it("returns easter egg when roll < 0.05", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.01);
      const name = generateActivityName("cycling", 8);
      // Easter eggs are longer/quirkier names
      const cyclingEasterEggs = [
        "Bicycle Race (Queen Approved)",
        "Tour de Fridge",
        "Breaking Away",
        "Ride Like the Wind",
        "I Want to Ride My Bicycle",
        "Take On Me (On Two Wheels)",
      ];
      expect(cyclingEasterEggs).toContain(name);
    });

    it("returns creative name when roll between 0.05 and 0.40", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.2);
      const name = generateActivityName("running", 8);
      const runningCreative = [
        "Tempo Run",
        "Easy Recovery",
        "Trail Run",
        "Interval Training",
        "Fartlek",
        "Long Run",
        "Progression Run",
        "Strides",
        "Speed Work",
        "Threshold Effort",
        "Shakeout Run",
        "Negative Splits",
        "Out & Back",
        "Track Session",
        "Hill Sprints",
        "Treadmill Session",
        "Cool Down Jog",
        "Race Day",
        "Recovery Shuffle",
        "Steady State",
      ];
      expect(runningCreative).toContain(name);
    });

    it("returns time-of-day + suffix when roll >= 0.40", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const name = generateActivityName("hiking", 14);
      // Should be "Afternoon|Post-Lunch" + "Hike|Trek|Walk|Ramble"
      expect(name).toMatch(/^(Afternoon|Post-Lunch) (Hike|Trek|Walk|Ramble)$/);
    });
  });

  describe("variety", () => {
    it("produces varied names across many calls", () => {
      vi.restoreAllMocks(); // Use real Math.random for this test
      const names = new Set<string>();
      for (let i = 0; i < 50; i++) {
        names.add(generateActivityName("cycling", 8));
      }
      // 50 calls should produce meaningful variety
      expect(names.size).toBeGreaterThan(5);
    });

    it("produces different names for different times of day", () => {
      vi.restoreAllMocks();
      const morningNames = new Set<string>();
      const eveningNames = new Set<string>();
      for (let i = 0; i < 30; i++) {
        morningNames.add(generateActivityName("running", 7));
        eveningNames.add(generateActivityName("running", 19));
      }
      // The sets should not be identical (different time prefixes)
      const allMorning = [...morningNames].join(",");
      const allEvening = [...eveningNames].join(",");
      expect(allMorning).not.toBe(allEvening);
    });
  });
});
