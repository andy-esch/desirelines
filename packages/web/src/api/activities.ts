import axios, { AxiosError } from "axios";
import type { RideBlobType } from "../types/activity";
import { EMPTY_RIDE_DATA } from "../constants";
import { API_BASE_URL } from "../config";

const getApiBaseUrl = (): string => {
  return API_BASE_URL || "http://localhost:8084";
};

// MULTI-SPORT API TYPES

// API Response - Raw array (not wrapped in object)
export type SportMetrics = Array<{
  date: string;
  distance?: number;
  elevation?: number;
  time?: number;
  activities?: number;
}>;

// API Response - Matches protobuf YearMetadata
export interface YearMetadata {
  year: number;
  sports: string[]; // ["cycling", "running", "yoga"]
  totals: Record<
    string,
    {
      distance_meters?: number; // FULL field name in metadata (meters)
      time_minutes?: number; // FULL field name in metadata (minutes)
      elevation_meters?: number; // FULL field name in metadata (meters)
      activities: number;
    }
  >;
  last_updated: string; // ISO timestamp
  aggregation_version: string; // "1.0"
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
    // 404 means no data for this year - return empty data (not an error)
    if (err instanceof AxiosError && err.response?.status === 404) {
      // Silently return empty data - no data available is a valid state
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

export const fetchSportMetrics = async (
  year: number,
  sport: string,
  signal?: AbortSignal,
  idToken?: string
): Promise<SportMetrics> => {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/activities/${year}/metrics?sport=${sport}`;

  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  try {
    const { data } = await axios.get<SportMetrics>(url, { signal, headers });
    return data;
  } catch (err: unknown) {
    // Request was cancelled - return empty data (expected behavior)
    if (axios.isCancel(err)) {
      return [];
    }
    // 404 means no data for this sport/year - return empty array (not an error)
    if (err instanceof AxiosError && err.response?.status === 404) {
      // Silently return empty data - no data available is a valid state
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
