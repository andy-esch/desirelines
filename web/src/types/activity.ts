export type DistanceEntry = {
  x: string;
  y: number;
};

export type PacingEntry = {
  x: string;
  y: number;
};

export interface RideBlobType {
  avg_distance: DistanceEntry[];
  distance_traveled: DistanceEntry[];
  lower_distance: DistanceEntry[];
  summaries: DistanceEntry[];
  upper_distance: DistanceEntry[];
}

export interface PacingBlobType {
  pacing: PacingEntry[];
  upper_pacing: PacingEntry[];
  lower_pacing: PacingEntry[];
  summaries: string[];
}
