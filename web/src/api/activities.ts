import axios from "axios";
import type { RideBlobType, PacingBlobType } from "../types/activity";
import { EMPTY_RIDE_DATA, EMPTY_PACING_DATA } from "../constants";

const getApiBaseUrl = (): string => {
  return (
    (window as { ENV?: { REACT_APP_API_URL?: string } }).ENV?.REACT_APP_API_URL ||
    import.meta.env.REACT_APP_API_URL ||
    "http://localhost:8084"
  );
};

export const fetchDistanceData = async (year: number): Promise<RideBlobType> => {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/activities/${year}/distances`;

  try {
    const {
      data: { avg_distance, distance_traveled, lower_distance, summaries, upper_distance },
    } = await axios.get(url);
    return {
      avg_distance,
      distance_traveled,
      lower_distance,
      summaries,
      upper_distance,
    };
  } catch (err) {
    console.error("Failed to fetch distance data:", err);
    return EMPTY_RIDE_DATA;
  }
};

export const fetchPacingData = async (year: number): Promise<PacingBlobType> => {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/activities/${year}/pacings`;

  try {
    const {
      data: { pacing, upper_pacing, lower_pacing, summaries },
    } = await axios.get(url);
    return {
      pacing,
      upper_pacing,
      lower_pacing,
      summaries,
    };
  } catch (err) {
    console.error("Failed to fetch pacing data:", err);
    return EMPTY_PACING_DATA;
  }
};
