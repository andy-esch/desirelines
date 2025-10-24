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
  distance_traveled: DistanceEntry[];
}
