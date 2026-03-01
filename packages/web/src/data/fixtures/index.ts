import type { SportConfig } from "../../api/activities";

/**
 * Sport configuration fixture matching API format: SportConfig
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
      stravaTypes: ["WeightTraining", "Crossfit", "Workout", "HIIT"],
      excludedTypes: [],
      primaryMetric: "time_minutes",
      metrics: ["time_minutes", "activities", "activity_ids"],
      hasDistance: false,
      hasElevation: false,
    },
  },
};
