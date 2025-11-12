import cycling2023 from "./activities/2023/metrics/cycling.json";
import cycling2024 from "./activities/2024/metrics/cycling.json";
import cycling2025 from "./activities/2025/metrics/cycling.json";
import running2023 from "./activities/2023/metrics/running.json";
import running2024 from "./activities/2024/metrics/running.json";
import running2025 from "./activities/2025/metrics/running.json";
import yoga2024 from "./activities/2024/metrics/yoga.json";
import yoga2025 from "./activities/2025/metrics/yoga.json";
import type { SportMetrics, SportConfig } from "../../api/activities";
import type { GoalsForYear } from "../../types/generated/user_config";

// Multi-sport fixture data matching API format: SportMetrics
export const FIXTURE_SPORT_METRICS: Record<string, Record<number, SportMetrics>> = {
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
    2023: [], // No yoga in 2023
    2024: yoga2024 as SportMetrics,
    2025: yoga2025 as SportMetrics,
  },
};

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
