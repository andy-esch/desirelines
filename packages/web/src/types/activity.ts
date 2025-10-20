export type DistanceEntry = {
  x: string;
  y: number;
};

// Pacing entry - used for client-side pacing calculations
// (not fetched from API, calculated from distance data)
export type PacingEntry = {
  x: string;
  y: number;
};

export interface RideBlobType {
  avg_distance: DistanceEntry[];
  distance_traveled: DistanceEntry[];
  lower_distance: DistanceEntry[];
  summaries: Record<string, string[]>;
  upper_distance: DistanceEntry[];
}
