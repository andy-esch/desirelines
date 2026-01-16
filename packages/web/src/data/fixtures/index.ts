import type { SportConfig } from "../../api/activities";

/**
 * Sport configuration fixture matching API format: SportConfig
 *
 * This defines the sport categories and their properties.
 * Used by both authenticated (API) and demo (generated) data paths.
 */
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
    hiking: {
      display_name: "Hiking",
      strava_types: ["Hike"],
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
    workout: {
      display_name: "Workout",
      strava_types: ["WeightTraining", "Crossfit", "Workout", "HIIT"],
      excluded_types: [],
      primary_metric: "time_minutes",
      metrics: ["time_minutes", "activities", "activity_ids"],
      has_distance: false,
      has_elevation: false,
    },
  },
};
