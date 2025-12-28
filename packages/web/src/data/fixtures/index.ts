import type { SportMetrics, SportConfig, YearMetadata } from "../../api/activities";
import type { GoalsForYear } from "../../types/generated/user_config";

// Lazy-loaded fixture data cache
let _fixtureCache: Record<string, Record<number, SportMetrics>> | null = null;
let _metadataCache: Record<number, YearMetadata> | null = null;

/**
 * Lazily load fixture data to avoid OOM in tests.
 * Only loads JSON files when actually accessed.
 */
async function loadFixtures(): Promise<Record<string, Record<number, SportMetrics>>> {
  if (_fixtureCache) return _fixtureCache;

  const [
    cycling2023,
    cycling2024,
    cycling2025,
    running2023,
    running2024,
    running2025,
    yoga2024,
    yoga2025,
  ] = await Promise.all([
    import("./activities/2023/metrics/cycling.json").then((m) => m.default),
    import("./activities/2024/metrics/cycling.json").then((m) => m.default),
    import("./activities/2025/metrics/cycling.json").then((m) => m.default),
    import("./activities/2023/metrics/running.json").then((m) => m.default),
    import("./activities/2024/metrics/running.json").then((m) => m.default),
    import("./activities/2025/metrics/running.json").then((m) => m.default),
    import("./activities/2024/metrics/yoga.json").then((m) => m.default),
    import("./activities/2025/metrics/yoga.json").then((m) => m.default),
  ]);

  _fixtureCache = {
    cycling: {
      2023: cycling2023 as SportMetrics,
      2024: cycling2024 as SportMetrics,
      2025: cycling2025 as SportMetrics,
    },
    running: {
      2023: running2023 as SportMetrics,
      2024: running2024 as SportMetrics,
      2025: running2025 as SportMetrics,
    },
    yoga: {
      2023: [],
      2024: yoga2024 as SportMetrics,
      2025: yoga2025 as SportMetrics,
    },
  };

  return _fixtureCache;
}

/**
 * Get fixture metrics for a sport and year.
 * Returns empty array if not found.
 */
export async function getFixtureMetrics(sport: string, year: number): Promise<SportMetrics> {
  const fixtures = await loadFixtures();
  return fixtures[sport]?.[year] ?? [];
}

/**
 * Synchronous access to fixtures - returns null if not yet loaded.
 * Use getFixtureMetrics for guaranteed data.
 */
export function getFixtureMetricsSync(sport: string, year: number): SportMetrics | null {
  if (!_fixtureCache) return null;
  return _fixtureCache[sport]?.[year] ?? [];
}

/**
 * Preload all fixtures into cache.
 * Call this at app startup for synchronous access later.
 */
export async function preloadFixtures(): Promise<void> {
  await loadFixtures();
}

// For backwards compatibility - will be deprecated
// These are now getters that throw if accessed before preload
export const FIXTURE_SPORT_METRICS: Record<string, Record<number, SportMetrics>> = new Proxy(
  {} as Record<string, Record<number, SportMetrics>>,
  {
    get(_, sport: string) {
      if (!_fixtureCache) {
        // Return empty object that returns empty arrays for any year
        return new Proxy(
          {},
          {
            get() {
              return [];
            },
          }
        );
      }
      return _fixtureCache[sport] ?? {};
    },
  }
);

// Sport configuration fixture matching API format: SportConfig
export const FIXTURE_SPORT_CONFIG: SportConfig = {
  version: "1.0",
  sport_categories: {
    cycling: {
      display_name: "Cycling",
      strava_types: ["Ride", "VirtualRide"],
      excluded_types: ["EBikeRide"],
      primary_metric: "distance_meters",
      metrics: [
        "distance_meters",
        "time_minutes",
        "elevation_meters",
        "activities",
        "activity_ids",
      ],
      has_distance: true,
      has_elevation: true,
    },
    running: {
      display_name: "Running",
      strava_types: ["Run", "VirtualRun", "TrailRun"],
      excluded_types: [],
      primary_metric: "distance_meters",
      metrics: [
        "distance_meters",
        "time_minutes",
        "elevation_meters",
        "activities",
        "activity_ids",
      ],
      has_distance: true,
      has_elevation: true,
    },
    yoga: {
      display_name: "Yoga",
      strava_types: ["Yoga"],
      excluded_types: [],
      primary_metric: "time_minutes",
      metrics: ["time_minutes", "activities", "activity_ids"],
      has_distance: false,
      has_elevation: false,
    },
  },
};

// Default demo goals (using proper protobuf structure)
export const FIXTURE_GOALS: GoalsForYear = {
  goals: [
    {
      id: "1",
      value: 2000,
      label: "Conservative",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "2",
      value: 2500,
      label: "Target",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "3",
      value: 3000,
      label: "Stretch",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ],
};

// Lazy load metadata
async function loadMetadata(): Promise<Record<number, YearMetadata>> {
  if (_metadataCache) return _metadataCache;

  const [metadata2024, metadata2025] = await Promise.all([
    import("./activities/2024/metadata.json").then((m) => m.default),
    import("./activities/2025/metadata.json").then((m) => m.default),
  ]);

  _metadataCache = {
    2024: metadata2024 as YearMetadata,
    2025: metadata2025 as YearMetadata,
  };

  return _metadataCache;
}

export async function getFixtureMetadata(year: number): Promise<YearMetadata | null> {
  const metadata = await loadMetadata();
  return metadata[year] ?? null;
}

// For backwards compatibility
export const FIXTURE_METADATA: Record<number, YearMetadata> = new Proxy(
  {} as Record<number, YearMetadata>,
  {
    get(_, year: string) {
      if (!_metadataCache) return null;
      return _metadataCache[Number(year)] ?? null;
    },
  }
);
