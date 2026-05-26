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

import getClient from "./client";
import { is404Error, throwApiError } from "./errors";
import {
  validateApiResponse,
  SportMetricsResponseSchema,
  YearMetadataResponseSchema,
  SportConfigResponseSchema,
  AllSportsDailySummaryResponseSchema,
  AllSportsMetricsResponseSchema,
  ActivityResponseSchema,
  ActivityListResponseSchema,
} from "./contracts";

// Import generated types from Protobuf definitions
import type {
  Activity,
  ActivitySummary,
  ListActivitiesResponse as ActivityListResponse,
  ListActivitiesRequest as ActivityListFilter,
} from "../types/generated/activities";

import type {
  CumulativeMetricsEntry as MetricsEntry,
  SportMetrics as SportMetricsProto,
  AllSportsMetrics as AllSportsMetricsProto,
  AllSportsDailySummary as AllSportsDailySummaryProto,
  YearMetadata,
  DailyActivity,
} from "../types/generated/sports_metrics";

// Re-export generated types for consumers
export type { Activity, ActivitySummary, ActivityListResponse, ActivityListFilter };
export type { MetricsEntry, YearMetadata, DailyActivity };

// Helper alias for the array type (frontend often uses just the array)
export type SportMetrics = MetricsEntry[];

/** Optional sustainable-pace ceiling used for the "danger zone" UI. */
export interface DangerPace {
  /** Threshold value in `unit`s per day. */
  valuePerDay: number;
  /** Unit the value is expressed in. The client converts to the user's display unit. */
  unit: "miles" | "kilometers" | "meters" | "feet" | "hours" | "minutes" | "sessions";
}

// Sport config response shape — sourced from `schemas/sports/sport_types.json`
// at the apigateway boundary, not generated from a proto. If the proto coverage
// expands to sport config in the future, regenerate and drop this declaration.
export interface SportConfig {
  version: string;
  sportCategories: Record<
    string,
    {
      displayName: string; // "Cycling"
      stravaTypes: string[]; // ["Ride", "VirtualRide"]
      excludedTypes: string[]; // ["EBikeRide"]
      primaryMetric: string; // "distance_meters"
      metrics: string[]; // ["distance_meters", "time_minutes", ...]
      hasDistance: boolean; // true for cycling/running, false for yoga
      hasElevation: boolean; // true for cycling/running, false for yoga
      dangerPace?: DangerPace; // optional sustainable-pace limit for the UI
    }
  >;
}

// MULTI-SPORT API FUNCTIONS

/** Options for fetching sport metrics */
export interface FetchSportMetricsOptions {
  year: number;
  sport: string;
  from?: string | undefined; // YYYY-MM-DD - if provided with 'to', uses date range query
  to?: string | undefined; // YYYY-MM-DD - if provided with 'from', uses date range query
  tz?: string | undefined; // IANA timezone (e.g., "America/New_York") — caps current-year series at "today" in this timezone
  signal?: AbortSignal | undefined;
}

export const fetchSportMetrics = async (
  options: FetchSportMetricsOptions
): Promise<SportMetrics> => {
  const params = new URLSearchParams({ sport: options.sport });
  if (options.from && options.to) {
    params.set("from", options.from);
    params.set("to", options.to);
  }
  if (options.tz) {
    params.set("tz", options.tz);
  }
  const url = `activities/${options.year}/metrics?${params.toString()}`;

  try {
    const { data: raw } = await getClient().get<SportMetricsProto>(
      url,
      options.signal ? { signal: options.signal } : {}
    );
    const data = validateApiResponse<SportMetricsProto>(
      SportMetricsResponseSchema,
      raw,
      "fetchSportMetrics"
    );
    return data.timeseries ?? [];
  } catch (err: unknown) {
    throwApiError(err, "fetchSportMetrics");
  }
};

export const fetchYearMetadata = async (
  year: number,
  signal?: AbortSignal
): Promise<YearMetadata> => {
  const url = `activities/${year}/metadata`;

  try {
    const { data: raw } = await getClient().get<YearMetadata>(url, signal ? { signal } : {});
    const data = validateApiResponse<YearMetadata>(
      YearMetadataResponseSchema,
      raw,
      "fetchYearMetadata"
    );
    // Ensure arrays are never null for safe iteration
    return {
      ...data,
      sports: data.sports ?? [],
      totals: data.totals ?? {},
    };
  } catch (err: unknown) {
    throwApiError(err, "fetchYearMetadata");
  }
};

export const fetchSportConfig = async (signal?: AbortSignal): Promise<SportConfig> => {
  const url = `sports/config`;

  try {
    const { data: raw } = await getClient().get<SportConfig>(url, signal ? { signal } : {});
    return validateApiResponse<SportConfig>(SportConfigResponseSchema, raw, "fetchSportConfig");
  } catch (err: unknown) {
    throwApiError(err, "fetchSportConfig");
  }
};

// MULTI-SPORT BATCH API FUNCTIONS
// These use ?sports=X,Y,Z (plural) to fetch data for multiple sports in a single request,
// reducing dashboard API calls from ~5N to ~5.

/** Options for multi-sport batch fetches */
export interface FetchMultiSportOptions {
  year: number;
  sports: string[];
  from?: string | undefined;
  to?: string | undefined;
  tz?: string | undefined; // IANA timezone (e.g., "America/New_York") — caps current-year series at "today" in this timezone
  signal?: AbortSignal | undefined;
}

/**
 * Fetch daily summaries for multiple sports in a single request.
 * Returns a map of sport → daily data (Record<string, DailyActivity>).
 */
export const fetchMultiSportDailySummary = async (
  options: FetchMultiSportOptions
): Promise<Record<string, Record<string, DailyActivity>>> => {
  const params = new URLSearchParams({ sports: options.sports.join(",") });
  if (options.from && options.to) {
    params.set("from", options.from);
    params.set("to", options.to);
  }
  if (options.tz) {
    params.set("tz", options.tz);
  }
  const url = `activities/${options.year}/source?${params.toString()}`;

  try {
    const { data: raw } = await getClient().get<AllSportsDailySummaryProto>(
      url,
      options.signal ? { signal: options.signal } : {}
    );
    const data = validateApiResponse<AllSportsDailySummaryProto>(
      AllSportsDailySummaryResponseSchema,
      raw,
      "fetchMultiSportDailySummary"
    );
    return Object.fromEntries(
      Object.entries(data.bySport ?? {}).map(([sport, summary]) => [sport, summary?.daily ?? {}])
    );
  } catch (err: unknown) {
    throwApiError(err, "fetchMultiSportDailySummary");
  }
};

/**
 * Fetch cumulative metrics for multiple sports in a single request.
 * Returns a map of sport → metrics timeseries (MetricsEntry[]).
 */
export const fetchMultiSportMetrics = async (
  options: FetchMultiSportOptions
): Promise<Record<string, SportMetrics>> => {
  const params = new URLSearchParams({ sports: options.sports.join(",") });
  if (options.from && options.to) {
    params.set("from", options.from);
    params.set("to", options.to);
  }
  if (options.tz) {
    params.set("tz", options.tz);
  }
  const url = `activities/${options.year}/metrics?${params.toString()}`;

  try {
    const { data: raw } = await getClient().get<AllSportsMetricsProto>(
      url,
      options.signal ? { signal: options.signal } : {}
    );
    const data = validateApiResponse<AllSportsMetricsProto>(
      AllSportsMetricsResponseSchema,
      raw,
      "fetchMultiSportMetrics"
    );
    return Object.fromEntries(
      Object.entries(data.bySport ?? {}).map(([sport, metrics]) => [
        sport,
        metrics?.timeseries ?? [],
      ])
    );
  } catch (err: unknown) {
    throwApiError(err, "fetchMultiSportMetrics");
  }
};

/**
 * Fetch a single activity by ID
 */
export const fetchActivity = async (id: number, signal?: AbortSignal): Promise<Activity | null> => {
  const url = `activities/${id}`;

  try {
    const { data: raw } = await getClient().get<Activity>(url, signal ? { signal } : {});
    return validateApiResponse<Activity>(ActivityResponseSchema, raw, "fetchActivity");
  } catch (err: unknown) {
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
  signal?: AbortSignal
): Promise<ActivityListResponse> => {
  const params = new URLSearchParams();
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.sport) params.set("sport", filter.sport);
  if (filter.limit) params.set("limit", filter.limit.toString());
  if (filter.cursor) params.set("cursor", filter.cursor);

  const url = `activities?${params.toString()}`;

  try {
    const { data: raw } = await getClient().get<ActivityListResponse>(
      url,
      signal ? { signal } : {}
    );
    const data = validateApiResponse<ActivityListResponse>(
      ActivityListResponseSchema,
      raw,
      "fetchActivities"
    );
    return {
      activities: data.activities ?? [],
      nextCursor: data.nextCursor,
      hasMore: data.hasMore ?? false,
    };
  } catch (err: unknown) {
    throwApiError(err, "fetchActivities");
  }
};
