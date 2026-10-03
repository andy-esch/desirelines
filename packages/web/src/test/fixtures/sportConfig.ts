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
  sportCategories: {
    cycling: {
      displayName: "Cycling",
      stravaTypes: ["Ride", "VirtualRide", "GravelRide"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "elevation_meters", "activities"],
      hasDistance: true,
      hasElevation: true,
    },
    running: {
      displayName: "Running",
      stravaTypes: ["Run", "VirtualRun", "TrailRun"],
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
    swimming: {
      displayName: "Swimming",
      stravaTypes: ["Swim"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "activities"],
      hasDistance: true,
      hasElevation: false,
    },
    hiking: {
      displayName: "Hiking",
      stravaTypes: ["Hike"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "elevation_meters", "activities"],
      hasDistance: true,
      hasElevation: true,
    },
    walking: {
      displayName: "Walking",
      stravaTypes: ["Walk"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: ["distance_meters", "time_minutes", "activities"],
      hasDistance: true,
      hasElevation: false,
    },
  },
};

/**
 * Minimal sport config with just the 3 core sports.
 * Use when you need a simpler fixture or want to test with fewer sports.
 */
export const mockMinimalSportConfig: SportConfig = {
  version: "1.0",
  sportCategories: {
    cycling: mockSportConfig.sportCategories.cycling!,
    running: mockSportConfig.sportCategories.running!,
    yoga: mockSportConfig.sportCategories.yoga!,
  },
};

/**
 * Default visible sports for most tests.
 */
export const defaultVisibleSports = ["cycling", "running", "yoga"];

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
  retry?: () => void;
}): DailySportDataResult {
  return {
    data: overrides?.data ?? mockDailySportData,
    isLoading: overrides?.isLoading ?? false,
    error: overrides?.error ?? null,
    retry: overrides?.retry ?? (() => {}),
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
