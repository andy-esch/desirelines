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

import axios, { AxiosError } from "axios";
import type { RideBlobType } from "../types/activity";
import { EMPTY_RIDE_DATA } from "../constants";
import { API_BASE_URL } from "../config";

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
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/activities/${year}/metrics?sport=cycling`;

  // Build headers with optional auth token
  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  try {
    const { data } = await axios.get<RideBlobType>(url, { signal, headers });
    return data;
  } catch (err: unknown) {
    // Request was cancelled - don't treat as error
    if (axios.isCancel(err)) {
      // Silently return empty data - cancellation is expected behavior
      return EMPTY_RIDE_DATA;
    }
    // LEGACY: 404 handling for old API endpoints that returned 404 for missing data.
    // New API contract returns 200 with empty arrays, so this is only hit for:
    // 1. Truly non-existent endpoints (wrong URL)
    // 2. Old backend versions before empty data normalization
    if (err instanceof AxiosError && err.response?.status === 404) {
      return EMPTY_RIDE_DATA;
    }
    // 401/403 means authentication/authorization failed
    if (
      err instanceof AxiosError &&
      (err.response?.status === 401 || err.response?.status === 403)
    ) {
      console.error("Authentication failed - user not authorized");
      throw new Error("Access denied. Please sign in with an authorized account.");
    }
    // Real errors (network, 500s, etc.) should propagate
    console.error("Failed to fetch distance data:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
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

  const apiBaseUrl = getApiBaseUrl();
  let url = `${apiBaseUrl}/activities/${options.year}/metrics?sport=${options.sport}`;

  // Add date range params if provided
  if (options.from && options.to) {
    url += `&from=${options.from}&to=${options.to}`;
  }

  const headers: Record<string, string> = {};
  if (options.idToken) {
    headers.Authorization = `Bearer ${options.idToken}`;
  }

  try {
    const { data } = await axios.get<SportMetricsResponse>(url, {
      signal: options.signal,
      headers,
    });
    // Extract timeseries array from response wrapper
    // API always returns 200 with empty array when no data (not 404)
    return data.timeseries ?? [];
  } catch (err: unknown) {
    // Request was cancelled - not an error, return empty
    if (axios.isCancel(err)) {
      return [];
    }
    // 401/403 means authentication/authorization failed
    if (
      err instanceof AxiosError &&
      (err.response?.status === 401 || err.response?.status === 403)
    ) {
      console.error("Authentication failed - user not authorized");
      throw new Error("Access denied. Please sign in with an authorized account.");
    }
    // Real errors (network, 500s, etc.) should propagate
    console.error("Failed to fetch sport metrics:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
  }
};

export const fetchYearMetadata = async (
  year: number,
  signal?: AbortSignal,
  idToken?: string
): Promise<YearMetadata> => {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/activities/${year}/metadata`;

  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  try {
    const { data } = await axios.get<YearMetadata>(url, { signal, headers });
    // API always returns 200 with empty sports/totals when no data (not 404)
    // Ensure arrays are never null for safe iteration
    return {
      ...data,
      sports: data.sports ?? [],
      totals: data.totals ?? {},
    };
  } catch (err: unknown) {
    if (axios.isCancel(err)) {
      throw new Error("Request cancelled");
    }
    // 401/403 means authentication/authorization failed
    if (
      err instanceof AxiosError &&
      (err.response?.status === 401 || err.response?.status === 403)
    ) {
      console.error("Authentication failed - user not authorized");
      throw new Error("Access denied. Please sign in with an authorized account.");
    }
    console.error("Failed to fetch year metadata:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
  }
};

export const fetchSportConfig = async (
  signal?: AbortSignal,
  idToken?: string
): Promise<SportConfig> => {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/sports/config`;

  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  try {
    const { data } = await axios.get<SportConfig>(url, { signal, headers });
    return data;
  } catch (err: unknown) {
    if (axios.isCancel(err)) {
      throw new Error("Request cancelled");
    }
    // 401/403 means authentication/authorization failed
    if (
      err instanceof AxiosError &&
      (err.response?.status === 401 || err.response?.status === 403)
    ) {
      console.error("Authentication failed - user not authorized");
      throw new Error("Access denied. Please sign in with an authorized account.");
    }
    console.error("Failed to fetch sport config:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
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
  const apiBaseUrl = getApiBaseUrl();
  let url = `${apiBaseUrl}/activities/${options.year}/source?sport=${options.sport}`;

  // Add date range params if provided
  if (options.from && options.to) {
    url += `&from=${options.from}&to=${options.to}`;
  }

  const headers: Record<string, string> = {};
  if (options.idToken) {
    headers.Authorization = `Bearer ${options.idToken}`;
  }

  try {
    // Expecting wrapped response: { daily: { ... } }
    const { data } = await axios.get<DailySummaryResponse>(url, {
      signal: options.signal,
      headers,
    });
    return data.daily ?? {};
  } catch (err: unknown) {
    if (axios.isCancel(err)) {
      return {};
    }
    if (
      err instanceof AxiosError &&
      (err.response?.status === 401 || err.response?.status === 403)
    ) {
      console.error("Authentication failed - user not authorized");
      throw new Error("Access denied. Please sign in with an authorized account.");
    }
    console.error("Failed to fetch daily summary:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
  }
};

// ACTIVITY LIST API TYPES

/** Activity summary returned in list responses */
export interface ActivitySummary {
  id: number;
  name: string;
  type: string;
  sport: string;
  start_date_local: string;
  distance_meters: number;
  moving_time_seconds: number;
  elevation_meters?: number;
}

/** Full activity details */
export interface Activity {
  id: number;
  name: string;
  type: string;
  sport: string;
  start_date_local: string;
  distance_meters: number;
  moving_time_seconds: number;
  elapsed_time_seconds: number;
  elevation_meters?: number;
  average_speed_mps?: number;
  max_speed_mps?: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

/** Paginated activity list response */
export interface ActivityListResponse {
  activities: ActivitySummary[];
  next_cursor?: string;
  has_more: boolean;
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
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/activities/${id}`;

  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  try {
    const { data } = await axios.get<Activity>(url, { signal, headers });
    return data;
  } catch (err: unknown) {
    if (axios.isCancel(err)) {
      return null;
    }
    if (err instanceof AxiosError && err.response?.status === 404) {
      return null;
    }
    if (
      err instanceof AxiosError &&
      (err.response?.status === 401 || err.response?.status === 403)
    ) {
      console.error("Authentication failed - user not authorized");
      throw new Error("Access denied. Please sign in with an authorized account.");
    }
    console.error("Failed to fetch activity:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
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
  const apiBaseUrl = getApiBaseUrl();
  const params = new URLSearchParams();

  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.sport) params.set("sport", filter.sport);
  if (filter.limit) params.set("limit", filter.limit.toString());
  if (filter.cursor) params.set("cursor", filter.cursor);

  const url = `${apiBaseUrl}/activities?${params.toString()}`;

  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  try {
    const { data } = await axios.get<ActivityListResponse>(url, { signal, headers });
    return {
      activities: data.activities ?? [],
      next_cursor: data.next_cursor,
      has_more: data.has_more ?? false,
    };
  } catch (err: unknown) {
    if (axios.isCancel(err)) {
      return { activities: [], has_more: false };
    }
    if (
      err instanceof AxiosError &&
      (err.response?.status === 401 || err.response?.status === 403)
    ) {
      console.error("Authentication failed - user not authorized");
      throw new Error("Access denied. Please sign in with an authorized account.");
    }
    console.error("Failed to fetch activities:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
  }
};
