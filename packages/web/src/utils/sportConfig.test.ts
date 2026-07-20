import { describe, it, expect } from "vitest";
import type { SportConfig } from "../api/activities";
import {
  SPORT_COLORS,
  getSportDisplayName,
  getPrimaryMetric,
  isDistanceSport,
  getSportMetrics,
  filterValidSports,
} from "./sportConfig";

/** Minimal sport config fixture for testing */
const mockSportConfig: SportConfig = {
  version: "1.0",
  sportCategories: {
    cycling: {
      displayName: "Cycling",
      stravaTypes: ["Ride"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "elevation_meters", "activities"],
      hasDistance: true,
      hasElevation: true,
    },
    yoga: {
      displayName: "Yoga",
      stravaTypes: ["Yoga"],
      excludedTypes: [],
      primaryMetric: "time_minutes",
      metrics: ["time_minutes", "activities"],
      hasDistance: false,
      hasElevation: false,
    },
    running: {
      displayName: "Running",
      stravaTypes: ["Run"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "activities"],
      hasDistance: true,
      hasElevation: true,
    },
  },
};

describe("SPORT_COLORS", () => {
  it("has colors defined for all expected sports", () => {
    const expectedSports = [
      "cycling",
      "running",
      "swimming",
      "ebike",
      "hiking",
      "walking",
      "winter_sports",
      "watersports",
      "yoga",
      "workout",
      "climbing",
      "racket_sports",
      "team_sports",
      "golf",
      "skating",
      "wheelchair",
    ];

    for (const sport of expectedSports) {
      expect(SPORT_COLORS[sport]).toBeDefined();
      expect(SPORT_COLORS[sport]).toMatch(/^rgb\(\d+,\s*\d+,\s*\d+\)$/);
    }
  });

  it("has unique colors for each sport", () => {
    const colors = Object.values(SPORT_COLORS);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(colors.length);
  });
});

describe("getSportDisplayName", () => {
  it("returns display name from config when available", () => {
    expect(getSportDisplayName("cycling", mockSportConfig)).toBe("Cycling");
    expect(getSportDisplayName("yoga", mockSportConfig)).toBe("Yoga");
  });

  it("formats sport key as fallback when not in config", () => {
    expect(getSportDisplayName("unknown_sport", mockSportConfig)).toBe("Unknown Sport");
    expect(getSportDisplayName("winter_sports", mockSportConfig)).toBe("Winter Sports");
  });

  it("handles null config gracefully", () => {
    expect(getSportDisplayName("cycling", null)).toBe("Cycling");
    expect(getSportDisplayName("team_sports", null)).toBe("Team Sports");
  });
});

describe("getPrimaryMetric", () => {
  it("returns primary metric from config for known sports", () => {
    expect(getPrimaryMetric("cycling", mockSportConfig)).toBe("distance_meters");
    expect(getPrimaryMetric("yoga", mockSportConfig)).toBe("time_minutes");
  });

  it("returns distance_meters as fallback for unknown sports", () => {
    expect(getPrimaryMetric("unknown_sport", mockSportConfig)).toBe("distance_meters");
  });

  it("handles null config gracefully", () => {
    expect(getPrimaryMetric("cycling", null)).toBe("distance_meters");
  });

  it("ignores userPrefs parameter for now (reserved for future)", () => {
    const userPrefs = { cycling: "time_minutes" };
    // Currently ignores user prefs, returns server default
    expect(getPrimaryMetric("cycling", mockSportConfig, userPrefs)).toBe("distance_meters");
  });
});

describe("isDistanceSport", () => {
  it("returns true for distance-based sports", () => {
    expect(isDistanceSport("cycling", mockSportConfig)).toBe(true);
    expect(isDistanceSport("running", mockSportConfig)).toBe(true);
  });

  it("returns false for non-distance sports", () => {
    expect(isDistanceSport("yoga", mockSportConfig)).toBe(false);
  });

  it("returns true for unknown sports (defaults to distance)", () => {
    expect(isDistanceSport("unknown", mockSportConfig)).toBe(true);
  });
});

describe("getSportMetrics", () => {
  it("returns metrics array for known sports", () => {
    const cyclingMetrics = getSportMetrics("cycling", mockSportConfig);
    expect(cyclingMetrics).toContain("distance_meters");
    expect(cyclingMetrics).toContain("time_minutes");
    expect(cyclingMetrics).toContain("elevation_meters");
  });

  it("returns empty array for unknown sports", () => {
    expect(getSportMetrics("unknown", mockSportConfig)).toEqual([]);
  });

  it("handles null config gracefully", () => {
    expect(getSportMetrics("cycling", null)).toEqual([]);
  });
});

describe("filterValidSports", () => {
  it("filters out sports not in config", () => {
    const visible = ["cycling", "yoga", "unknown_sport"];
    const filtered = filterValidSports(visible, mockSportConfig);

    expect(filtered).toContain("cycling");
    expect(filtered).toContain("yoga");
    expect(filtered).not.toContain("unknown_sport");
  });

  it("preserves order of valid sports", () => {
    const visible = ["yoga", "cycling", "running"];
    const filtered = filterValidSports(visible, mockSportConfig);

    expect(filtered).toEqual(["yoga", "cycling", "running"]);
  });

  it("returns original array when config is null", () => {
    const visible = ["cycling", "unknown"];
    const filtered = filterValidSports(visible, null);

    expect(filtered).toEqual(visible);
  });

  it("handles empty arrays", () => {
    expect(filterValidSports([], mockSportConfig)).toEqual([]);
  });
});

describe("SPORT_COLORS palette invariants", () => {
  /**
   * Every sport in the canonical registry needs a color.
   *
   * This is the guarantee that would otherwise require putting colors in
   * `schemas/sports/sport_types.json` — cheaper here, because reaching the web from
   * the registry would mean an apigateway struct + API contract change just to carry a
   * presentation concern. If a sport is added upstream and nobody picks a color, this
   * fails instead of the sport silently rendering in the grey fallback.
   *
   * `other` is excluded on purpose: it is the catch-all bucket, and DEFAULT_SPORT_COLOR
   * is the right answer for it.
   */
  it("covers every sport in the canonical registry", async () => {
    const registry = await import("../../../../schemas/sports/sport_types.json");
    const sports = Object.keys(registry.default.sportCategories).filter((s) => s !== "other");

    // Guard against the check passing vacuously if the import shape ever changes.
    expect(sports.length).toBeGreaterThan(10);

    const missing = sports.filter((s) => !SPORT_COLORS[s]);
    expect(missing, `sports with no SPORT_COLORS entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no duplicate colors", () => {
    const values = Object.values(SPORT_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });

  /**
   * The palette's real invariants. These were satisfied by construction when the values
   * were computed, but nothing enforced them afterwards — so editing a single hex could
   * silently reintroduce a colorblind collision or an invisible mark. Both properties
   * are cheap to assert, so assert them.
   */
  const parse = (c: string): [number, number, number] => {
    const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)!;
    return [+m[1]!, +m[2]!, +m[3]!];
  };
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const mul = (m: number[][], v: number[]) =>
    m.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
  const unlin = (c: number) => {
    const x = Math.min(1, Math.max(0, c));
    return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  };
  const RGB2LMS = [
    [17.8824, 43.5161, 4.11935],
    [3.45565, 27.1554, 3.86714],
    [0.0299566, 0.184309, 1.46709],
  ];
  const LMS2RGB = [
    [0.0809444479, -0.130504409, 0.116721066],
    [-0.0102485335, 0.0540193266, -0.113614708],
    [-0.000365296938, -0.00412161469, 0.693511405],
  ];
  // Viénot/Brettel/Mollon 1999 dichromat projections.
  const DEUT = [
    [1, 0, 0],
    [0.494207, 0, 1.24827],
    [0, 0, 1],
  ];
  const PROT = [
    [0, 2.02344, -2.52581],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const simulate = (rgb: number[], m: number[][]) =>
    mul(LMS2RGB, mul(m, mul(RGB2LMS, rgb.map(lin)))).map(unlin);
  const lab = (rgb: number[]) => {
    const [r, g, b] = rgb.map(lin) as [number, number, number];
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const de = (a: number[], b: number[]) => {
    const [A, B] = [lab(a), lab(b)];
    return Math.hypot(A[0]! - B[0]!, A[1]! - B[1]!, A[2]! - B[2]!);
  };
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map(lin) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number[], b: number[]) => {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  it("keeps every pair separable under deuteranopia and protanopia", () => {
    const entries = Object.entries(SPORT_COLORS).map(([s, c]) => [s, parse(c)] as const);
    const failures: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [sa, a] = entries[i]!;
        const [sb, b] = entries[j]!;
        const worst = Math.min(
          de(a, b),
          de(simulate(a, DEUT), simulate(b, DEUT)),
          de(simulate(a, PROT), simulate(b, PROT))
        );
        // 12 dE is roughly "tells apart at a glance"; the palette was built to 15.3.
        if (worst < 12) failures.push(`${sa}/${sb} = ${worst.toFixed(1)}`);
      }
    }
    expect(failures, `pairs below 12 dE: ${failures.join(", ")}`).toEqual([]);
  });

  it("clears 3:1 against the dark background", () => {
    // Light mode can fall back to --color-chart-mark-outline; dark mode cannot, because
    // that token resolves to the page ground there. So the floor only binds on dark.
    const DARK = [15, 23, 36];
    const failures = Object.entries(SPORT_COLORS)
      .map(([s, c]) => [s, contrast(parse(c), DARK)] as const)
      .filter(([, r]) => r < 3)
      .map(([s, r]) => `${s} = ${r.toFixed(2)}:1`);
    expect(failures, `below 3:1 on dark: ${failures.join(", ")}`).toEqual([]);
  });
});
