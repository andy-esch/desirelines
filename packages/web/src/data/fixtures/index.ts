import type { SportConfig } from "../../api/activities";

/**
 * Sport configuration fixture matching API format: SportConfig
 *
 * SOURCE OF TRUTH: schemas/sports/sport_types.json
 * If you update this fixture, ensure the source of truth is updated as well.
 * The backend packages are synced automatically via 'just sync-sport-config',
 * but this TypeScript fixture must be updated manually.
 *
 * This defines the sport categories and their properties.
 * Used by both authenticated (API) and demo (generated) data paths.
 */
export const FIXTURE_SPORT_CONFIG: SportConfig = {
  version: "1.0",
  sportCategories: {
    cycling: {
      displayName: "Cycling",
      stravaTypes: ["Ride", "VirtualRide"],
      excludedTypes: ["EBikeRide"],
      primaryMetric: "distance_meters",
      metrics: [
        "distance_meters",
        "time_minutes",
        "elevation_meters",
        "activities",
        "activity_ids",
      ],
      hasDistance: true,
      hasElevation: true,
    },
    running: {
      displayName: "Running",
      stravaTypes: ["Run", "VirtualRun", "TrailRun"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: [
        "distance_meters",
        "time_minutes",
        "elevation_meters",
        "activities",
        "activity_ids",
      ],
      hasDistance: true,
      hasElevation: true,
    },
    yoga: {
      displayName: "Yoga",
      stravaTypes: ["Yoga"],
      excludedTypes: [],
      primaryMetric: "time_minutes",
      metrics: ["time_minutes", "activities", "activity_ids"],
      hasDistance: false,
      hasElevation: false,
    },
    hiking: {
      displayName: "Hiking",
      stravaTypes: ["Hike"],
      excludedTypes: [],
      primaryMetric: "distance_meters",
      metrics: [
        "distance_meters",
        "time_minutes",
        "elevation_meters",
        "activities",
        "activity_ids",
      ],
      hasDistance: true,
      hasElevation: true,
    },
    workout: {
      displayName: "Workout",
      stravaTypes: [
        "WeightTraining",
        "Crossfit",
        "Workout",
        "HIIT",
        "HighIntensityIntervalTraining",
      ],
      excludedTypes: [],
      primaryMetric: "time_minutes",
      metrics: ["time_minutes", "activities", "activity_ids"],
      hasDistance: false,
      hasElevation: false,
    },
    // "other" is the catch-all category the backend assigns to any Strava
    // sport_type that isn't explicitly mapped (e.g., a new SportType Strava
    // added upstream before we registered it). Mirroring it in the demo
    // fixture keeps demo-mode consistent with production once an unknown
    // sport lands. See schemas/sports/sport_types.json — the sentinel
    // stravaTypes entry is intentional; "other" is populated by the
    // fallback path, not by direct matching.
    other: {
      displayName: "Other",
      stravaTypes: ["__unmapped_sport_type__"],
      excludedTypes: [],
      primaryMetric: "time_minutes",
      metrics: ["time_minutes", "activities", "activity_ids"],
      hasDistance: false,
      hasElevation: false,
    },
  },
};
