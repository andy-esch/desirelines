import axios, { AxiosError } from "axios";
import type { RideBlobType } from "../types/activity";
import { EMPTY_RIDE_DATA } from "../constants";
import { API_BASE_URL } from "../config";

const getApiBaseUrl = (): string => {
  return API_BASE_URL || "http://localhost:8084";
};

export const fetchDistanceData = async (
  year: number,
  signal?: AbortSignal,
  idToken?: string
): Promise<RideBlobType> => {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/activities/${year}/distances`;

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
