import axios, { AxiosError } from "axios";
import type { RideBlobType } from "../types/activity";
import { EMPTY_RIDE_DATA } from "../constants";

const getApiBaseUrl = (): string => {
  return (
    window.ENV?.REACT_APP_API_URL || import.meta.env.REACT_APP_API_URL || "http://localhost:8084"
  );
};

export const fetchDistanceData = async (
  year: number,
  signal?: AbortSignal
): Promise<RideBlobType> => {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/activities/${year}/distances`;

  try {
    const {
      data: { avg_distance, distance_traveled, lower_distance, summaries, upper_distance },
    } = await axios.get(url, { signal });
    return {
      avg_distance,
      distance_traveled,
      lower_distance,
      summaries,
      upper_distance,
    };
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
    // Real errors (network, 500s, etc.) should propagate
    console.error("Failed to fetch distance data:", err instanceof Error ? err.message : err);
    throw err instanceof Error ? err : new Error(String(err));
  }
};
