import type { RideBlobType, PacingBlobType } from "../types/activity";

export const EMPTY_RIDE_DATA: RideBlobType = {
  avg_distance: [],
  distance_traveled: [],
  lower_distance: [],
  summaries: [],
  upper_distance: [],
};

export const EMPTY_PACING_DATA: PacingBlobType = {
  pacing: [],
  upper_pacing: [],
  lower_pacing: [],
  summaries: [],
};
