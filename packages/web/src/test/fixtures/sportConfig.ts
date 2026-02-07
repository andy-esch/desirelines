/**
 * Shared Test Fixtures for Sport Configuration
 *
 * These fixtures provide consistent mock data for testing components
 * that depend on sport configuration. Using shared fixtures ensures:
 * - Consistent test data across the codebase
 * - Single source of truth for test sport definitions
 * - Easy updates when sport config schema changes
 *
 * USAGE:
 * ```typescript
 * import { mockSportConfig, mockVisibleSportsReturn } from "../../test/fixtures/sportConfig";
 *
 * mockUseSportConfig.mockReturnValue(mockSportConfigReturn());
 * mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn());
 * ```
 */

import type { SportConfig } from "../../api/activities";
import type { MultiSportData, DailySportDataResult } from "../../hooks/useDailySportData";

/**
 * Complete mock sport config matching the production schema.
 * Includes cycling, running, and yoga - the most commonly tested sports.
 */
export const mockSportConfig: SportConfig = {
  version: "1.0",
  sport_categories: {
    cycling: {
      display_name: "Cycling",
      strava_types: ["Ride", "VirtualRide", "GravelRide"],
      excluded_types: [],
      primary_metric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "elevation_meters", "activities"],
      has_distance: true,
      has_elevation: true,
    },
    running: {
      display_name: "Running",
      strava_types: ["Run", "VirtualRun", "TrailRun"],
      excluded_types: [],
      primary_metric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "elevation_meters", "activities"],
      has_distance: true,
      has_elevation: true,
    },
    yoga: {
      display_name: "Yoga",
      strava_types: ["Yoga"],
      excluded_types: [],
      primary_metric: "time_minutes",
      metrics: ["time_minutes", "activities"],
      has_distance: false,
      has_elevation: false,
    },
    swimming: {
      display_name: "Swimming",
      strava_types: ["Swim"],
      excluded_types: [],
      primary_metric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "activities"],
      has_distance: true,
      has_elevation: false,
    },
    hiking: {
      display_name: "Hiking",
      strava_types: ["Hike"],
      excluded_types: [],
      primary_metric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "elevation_meters", "activities"],
      has_distance: true,
      has_elevation: true,
    },
    walking: {
      display_name: "Walking",
      strava_types: ["Walk"],
      excluded_types: [],
      primary_metric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "activities"],
      has_distance: true,
      has_elevation: false,
    },
  },
};

/**
 * Minimal sport config with just the 3 core sports.
 * Use when you need a simpler fixture or want to test with fewer sports.
 */
export const mockMinimalSportConfig: SportConfig = {
  version: "1.0",
  sport_categories: {
    cycling: mockSportConfig.sport_categories.cycling,
    running: mockSportConfig.sport_categories.running,
    yoga: mockSportConfig.sport_categories.yoga,
  },
};

/**
 * Default visible sports for most tests.
 */
export const defaultVisibleSports = ["cycling", "running", "yoga"];

/**
 * Extended visible sports list for testing with more sports.
 */
export const extendedVisibleSports = ["cycling", "running", "yoga", "swimming", "hiking"];

/**
 * Factory function for useSportConfig mock return value.
 * Allows easy customization of loading/error states.
 */
export function mockSportConfigReturn(overrides?: {
  sportConfig?: SportConfig | null;
  isLoading?: boolean;
  error?: Error | null;
}) {
  return {
    sportConfig: overrides?.sportConfig ?? mockSportConfig,
    isLoading: overrides?.isLoading ?? false,
    error: overrides?.error ?? null,
    retry: vi.fn(),
  };
}

/**
 * Factory function for useVisibleSports mock return value.
 * Allows easy customization of visible sports and loading states.
 */
export function mockVisibleSportsReturn(overrides?: {
  visibleSports?: string[];
  isLoading?: boolean;
  error?: Error | null;
  isSaving?: boolean;
  saveError?: Error | null;
}) {
  return {
    visibleSports: overrides?.visibleSports ?? defaultVisibleSports,
    setVisibleSports: vi.fn(),
    isLoading: overrides?.isLoading ?? false,
    error: overrides?.error ?? null,
    isSaving: overrides?.isSaving ?? false,
    saveError: overrides?.saveError ?? null,
    clearSaveError: vi.fn(),
  };
}

/**
 * Mock daily sport data for testing.
 * Provides sample activity data across multiple sports and dates.
 */
export const mockDailySportData: MultiSportData = {
  cycling: {
    "2026-01-02": {
      distanceMeters: 45000,
      timeMinutes: 90,
      elevationMeters: 500,
      activities: 1,
      activityIds: [1],
    },
    "2026-01-03": {
      distanceMeters: 30000,
      timeMinutes: 60,
      elevationMeters: 300,
      activities: 1,
      activityIds: [2],
    },
    "2026-01-05": {
      distanceMeters: 80000,
      timeMinutes: 180,
      elevationMeters: 1200,
      activities: 2,
      activityIds: [3, 4],
    },
  },
  running: {
    "2026-01-02": {
      distanceMeters: 8000,
      timeMinutes: 45,
      elevationMeters: 50,
      activities: 1,
      activityIds: [5],
    },
    "2026-01-04": {
      distanceMeters: 12000,
      timeMinutes: 65,
      elevationMeters: 100,
      activities: 1,
      activityIds: [6],
    },
  },
  yoga: {
    "2026-01-01": {
      timeMinutes: 30,
      activities: 1,
      activityIds: [7],
    },
    "2026-01-03": {
      timeMinutes: 45,
      activities: 1,
      activityIds: [8],
    },
    "2026-01-06": {
      timeMinutes: 60,
      activities: 2,
      activityIds: [9, 10],
    },
  },
};

/**
 * Empty daily sport data for testing empty states.
 */
export const emptyDailySportData: MultiSportData = {
  cycling: {},
  running: {},
  yoga: {},
};

/**
 * Factory function for useDailySportData mock return value.
 */
export function mockDailySportDataReturn(overrides?: {
  data?: MultiSportData;
  isLoading?: boolean;
  error?: Error | null;
}): DailySportDataResult {
  return {
    data: overrides?.data ?? mockDailySportData,
    isLoading: overrides?.isLoading ?? false,
    error: overrides?.error ?? null,
  };
}

/**
 * Mock activities for testing activity lists.
 */
export const mockActivities = [
  {
    id: 123456789,
    name: "Morning Ride",
    type: "Ride",
    sport: "cycling",
    startDateLocal: "2026-01-05T08:30:00",
    distanceMeters: 45000,
    movingTimeSeconds: 5400,
    elevationMeters: 450,
  },
  {
    id: 123456790,
    name: "Evening Run",
    type: "Run",
    sport: "running",
    startDateLocal: "2026-01-04T18:00:00",
    distanceMeters: 8000,
    movingTimeSeconds: 2400,
    elevationMeters: 50,
  },
  {
    id: 123456791,
    name: "Yoga Flow",
    type: "Yoga",
    sport: "yoga",
    startDateLocal: "2026-01-03T07:00:00",
    distanceMeters: 0,
    movingTimeSeconds: 1800,
  },
  {
    id: 123456792,
    name: "Hill Climb",
    type: "Ride",
    sport: "cycling",
    startDateLocal: "2026-01-02T10:00:00",
    distanceMeters: 30000,
    movingTimeSeconds: 4200,
    elevationMeters: 800,
  },
  {
    id: 123456793,
    name: "Recovery Run",
    type: "Run",
    sport: "running",
    startDateLocal: "2026-01-01T16:00:00",
    distanceMeters: 5000,
    movingTimeSeconds: 1800,
    elevationMeters: 20,
  },
];

/**
 * Factory function for useActivities mock return value.
 */
export function mockActivitiesReturn(overrides?: {
  activities?: typeof mockActivities;
  isLoading?: boolean;
  error?: Error | null;
  hasMore?: boolean;
}) {
  return {
    activities: overrides?.activities ?? mockActivities,
    isLoading: overrides?.isLoading ?? false,
    error: overrides?.error ?? null,
    hasMore: overrides?.hasMore ?? false,
    loadMore: vi.fn(),
    retry: vi.fn(),
  };
}

/**
 * Factory function for useAuth mock return value.
 */
export function mockAuthReturn(overrides?: {
  user?: { uid: string; email: string; displayName: string } | null;
  loading?: boolean;
  error?: Error | null;
}) {
  return {
    user: overrides?.user ?? {
      uid: "user-123",
      email: "test@example.com",
      displayName: "Test User",
    },
    loading: overrides?.loading ?? false,
    error: overrides?.error ?? null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
}
