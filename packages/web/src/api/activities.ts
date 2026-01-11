/**
 * API Client for Activities
 *
 * API Contract for Empty/Missing Data:
 * ------------------------------------
 * The API follows a consistent pattern for handling missing data:
 *
 * | Scenario              | HTTP Status | Response Body                              |
 * |-----------------------|-------------|--------------------------------------------|
 * | Year/sport has data   | 200         | { timeseries: [...] } or { sports: [...] } |
 * | Year/sport NO data    | 200         | { timeseries: [] } or { sports: [] }       |
 * | Invalid year format   | 400         | { error: "Invalid year format" }           |
 * | Invalid sport         | 400         | { error: "Invalid sport: X" }              |
 * | Auth failure          | 401/403     | { error: "..." }                           |
 * | DB/Server error       | 500         | { error: "Internal server error" }         |
 *
 * Key principle: Empty data is NOT an error. The API returns 200 with empty
 * arrays/objects. 404 is only used for truly non-existent resources (wrong endpoint).
 *
 * Frontend handling:
 * - 200 responses: Display data (or empty state if arrays are empty)
 * - 400 responses: Show validation error to user
 * - 401/403: Redirect to login or show access denied
 * - 500: Show error message with retry option
 * - Cancelled requests: Silently ignore (return empty data)
 */

import axios from "axios";
import type { RideBlobType } from "../types/activity";
import { EMPTY_RIDE_DATA } from "../constants";
import { API_BASE_URL } from "../config";
import { isCancellationError, is404Error, buildAuthHeaders, throwApiError } from "./errors";

const getApiBaseUrl = (): string => {
  return API_BASE_URL || "http://localhost:8084";
};

// MULTI-SPORT API TYPES

// Metric entry from API
export interface MetricsEntry {
  date: string;
  distance?: number;
  elevation?: number;
  time?: number;
  activities?: number;
}

// API Response wrapper - matches Go struct { timeseries: [...] }
interface SportMetricsResponse {
  timeseries: MetricsEntry[];
}

// What the frontend uses (just the array)
export type SportMetrics = MetricsEntry[];

// API Response - Matches protobuf YearMetadata
export interface YearMetadata {
  year: number;
  sports: string[]; // ["cycling", "running", "yoga"]
  totals: Record<
    string,
    {
      distanceMeters?: number; // FULL field name in metadata (meters)
      timeMinutes?: number; // FULL field name in metadata (minutes)
      elevationMeters?: number; // FULL field name in metadata (meters)
      activities: number;
    }
  >;
  lastUpdated: string; // ISO timestamp
  aggregationVersion: string; // "1.0"
}

// API Response - Matches protobuf sport config structure
export interface SportConfig {
  version: string;
  sport_categories: Record<
    string,
    {
      display_name: string; // "Cycling"
      strava_types: string[]; // ["Ride", "VirtualRide"]
      excluded_types: string[]; // ["EBikeRide"]
      primary_metric: string; // "distance_meters"
      metrics: string[]; // ["distance_meters", "time_minutes", ...]
      has_distance: boolean; // true for cycling/running, false for yoga
      has_elevation: boolean; // true for cycling/running, false for yoga
    }
  >;
}

// API Response - Matches protobuf DailyActivity
export interface DailyActivity {
  distanceMeters?: number;
  timeMinutes?: number;
  elevationMeters?: number;
  activities: number;
  activityIds: number[];
}

// API Response - Matches protobuf DailySummary (wrapped)
export interface DailySummaryResponse {
  daily: Record<string, DailyActivity>;
}

export const fetchDistanceData = async (
  year: number,
  signal?: AbortSignal,
  idToken?: string
): Promise<RideBlobType> => {
  const url = `${getApiBaseUrl()}/activities/${year}/metrics?sport=cycling`;

  try {
    const { data } = await axios.get<RideBlobType>(url, {
      signal,
      headers: buildAuthHeaders(idToken),
    });
    return data;
  } catch (err: unknown) {
    if (isCancellationError(err)) {
      return EMPTY_RIDE_DATA;
    }
    // LEGACY: 404 handling for old API endpoints that returned 404 for missing data
    if (is404Error(err)) {
      return EMPTY_RIDE_DATA;
    }
    throwApiError(err, "fetchDistanceData");
  }
};

// MULTI-SPORT API FUNCTIONS

/** Options for fetching sport metrics */
export interface FetchSportMetricsOptions {
  year: number;
  sport: string;
  from?: string; // YYYY-MM-DD - if provided with 'to', uses date range query
  to?: string; // YYYY-MM-DD - if provided with 'from', uses date range query
  signal?: AbortSignal;
  idToken?: string;
}

export const fetchSportMetrics = async (
  yearOrOptions: number | FetchSportMetricsOptions,
  sport?: string,
  signal?: AbortSignal,
  idToken?: string
): Promise<SportMetrics> => {
  // Support both old signature (year, sport, signal, idToken) and new options object
  const options: FetchSportMetricsOptions =
    typeof yearOrOptions === "number"
      ? { year: yearOrOptions, sport: sport!, signal, idToken }
      : yearOrOptions;

  let url = `${getApiBaseUrl()}/activities/${options.year}/metrics?sport=${options.sport}`;
  if (options.from && options.to) {
    url += `&from=${options.from}&to=${options.to}`;
  }

  try {
    const { data } = await axios.get<SportMetricsResponse>(url, {
      signal: options.signal,
      headers: buildAuthHeaders(options.idToken),
    });
    return data.timeseries ?? [];
  } catch (err: unknown) {
    if (isCancellationError(err)) {
      return [];
    }
    throwApiError(err, "fetchSportMetrics");
  }
};

/** Empty metadata response for cancelled requests or error recovery */
const EMPTY_YEAR_METADATA: YearMetadata = {
  year: 0,
  sports: [],
  totals: {},
  lastUpdated: "",
  aggregationVersion: "",
};

export const fetchYearMetadata = async (
  year: number,
  signal?: AbortSignal,
  idToken?: string
): Promise<YearMetadata> => {
  const url = `${getApiBaseUrl()}/activities/${year}/metadata`;

  try {
    const { data } = await axios.get<YearMetadata>(url, {
      signal,
      headers: buildAuthHeaders(idToken),
    });
    // Ensure arrays are never null for safe iteration
    return {
      ...data,
      sports: data.sports ?? [],
      totals: data.totals ?? {},
    };
  } catch (err: unknown) {
    if (isCancellationError(err)) {
      return { ...EMPTY_YEAR_METADATA, year };
    }
    throwApiError(err, "fetchYearMetadata");
  }
};

/** Empty sport config for cancelled requests or error recovery */
const EMPTY_SPORT_CONFIG: SportConfig = {
  version: "",
  sport_categories: {},
};

export const fetchSportConfig = async (
  signal?: AbortSignal,
  idToken?: string
): Promise<SportConfig> => {
  const url = `${getApiBaseUrl()}/sports/config`;

  try {
    const { data } = await axios.get<SportConfig>(url, {
      signal,
      headers: buildAuthHeaders(idToken),
    });
    return data;
  } catch (err: unknown) {
    if (isCancellationError(err)) {
      return EMPTY_SPORT_CONFIG;
    }
    throwApiError(err, "fetchSportConfig");
  }
};

/** Options for fetchDailySummary */
export interface FetchDailySummaryOptions {
  year: number;
  sport: string;
  signal?: AbortSignal;
  idToken?: string;
  /** Start date (YYYY-MM-DD) for date-range queries */
  from?: string;
  /** End date (YYYY-MM-DD) for date-range queries */
  to?: string;
}

export const fetchDailySummary = async (
  options: FetchDailySummaryOptions
): Promise<Record<string, DailyActivity>> => {
  let url = `${getApiBaseUrl()}/activities/${options.year}/source?sport=${options.sport}`;
  if (options.from && options.to) {
    url += `&from=${options.from}&to=${options.to}`;
  }

  try {
    const { data } = await axios.get<DailySummaryResponse>(url, {
      signal: options.signal,
      headers: buildAuthHeaders(options.idToken),
    });
    return data.daily ?? {};
  } catch (err: unknown) {
    if (isCancellationError(err)) {
      return {};
    }
    throwApiError(err, "fetchDailySummary");
  }
};

// ACTIVITY LIST API TYPES
// Note: Field names are camelCase to match protojson serialization from the backend

/** Activity summary returned in list responses */
export interface ActivitySummary {
  id: number;
  name: string;
  type: string;
  sport: string;
  startDateLocal: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  elevationMeters?: number;
}

/** Full activity details */
export interface Activity {
  id: number;
  name: string;
  type: string;
  sport: string;
  startDateLocal: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  elevationMeters?: number;
  averageSpeedMps?: number;
  maxSpeedMps?: number;
  averageHeartrate?: number;
  maxHeartrate?: number;
}

/** Paginated activity list response */
export interface ActivityListResponse {
  activities: ActivitySummary[];
  nextCursor?: string;
  hasMore: boolean;
}

/** Filter options for listing activities */
export interface ActivityListFilter {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  sport?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Fetch a single activity by ID
 */
export const fetchActivity = async (
  id: number,
  signal?: AbortSignal,
  idToken?: string
): Promise<Activity | null> => {
  const url = `${getApiBaseUrl()}/activities/${id}`;

  try {
    const { data } = await axios.get<Activity>(url, {
      signal,
      headers: buildAuthHeaders(idToken),
    });
    return data;
  } catch (err: unknown) {
    if (isCancellationError(err)) {
      return null;
    }
    // 404 means activity not found - return null, not an error
    if (is404Error(err)) {
      return null;
    }
    throwApiError(err, "fetchActivity");
  }
};

/**
 * Fetch paginated list of activities
 */
export const fetchActivities = async (
  filter: ActivityListFilter,
  signal?: AbortSignal,
  idToken?: string
): Promise<ActivityListResponse> => {
  const params = new URLSearchParams();
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.sport) params.set("sport", filter.sport);
  if (filter.limit) params.set("limit", filter.limit.toString());
  if (filter.cursor) params.set("cursor", filter.cursor);

  const url = `${getApiBaseUrl()}/activities?${params.toString()}`;

  try {
    const { data } = await axios.get<ActivityListResponse>(url, {
      signal,
      headers: buildAuthHeaders(idToken),
    });
    return {
      activities: data.activities ?? [],
      nextCursor: data.nextCursor,
      hasMore: data.hasMore ?? false,
    };
  } catch (err: unknown) {
    if (isCancellationError(err)) {
      return { activities: [], hasMore: false };
    }
    throwApiError(err, "fetchActivities");
  }
};
