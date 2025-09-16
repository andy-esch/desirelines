import axios from "axios";

type distanceEntry = {
  x: string;
  y: number;
};
type pacingEntry = {
  x: string;
  y: number;
};

export interface rideBlobType {
  avg_distance: distanceEntry[];
  distance_traveled: distanceEntry[];
  lower_distance: distanceEntry[];
  summaries: distanceEntry[];
  upper_distance: distanceEntry[];
}

export interface pacingBlobType {
  pacing: pacingEntry[];
  upper_pacing: pacingEntry[];
  lower_pacing: pacingEntry[];
  summaries: string[];
}

export const emptyRideData: rideBlobType = {
  avg_distance: [],
  distance_traveled: [],
  lower_distance: [],
  summaries: [],
  upper_distance: [],
};

export const emptyPacingData: pacingBlobType = {
  pacing: [],
  upper_pacing: [],
  lower_pacing: [],
  summaries: [],
};

export const fetchDistanceData = async (year: number) => {
  // Use API gateway instead of direct bucket access
  // Try runtime config first, then env var, then localhost fallback
  const apiBaseUrl =
    (window as any).ENV?.REACT_APP_API_URL ||
    process.env.REACT_APP_API_URL ||
    "http://localhost:8084";
  const url = `${apiBaseUrl}/activities/${year}/distances`;
  console.log("Fetching distance data from:", url);

  let rideData: rideBlobType = emptyRideData;
  try {
    const {
      data: {
        avg_distance,
        distance_traveled,
        lower_distance,
        summaries,
        upper_distance,
      },
    } = await axios.get(url);
    console.log("Distance data received:", distance_traveled);
    rideData = {
      avg_distance,
      distance_traveled,
      lower_distance,
      summaries,
      upper_distance,
    };
    return rideData;
  } catch (err) {
    console.error("Failed to fetch distance data:", err);
  }
  return emptyRideData;
};

export const fetchPacingData = async (year: number) => {
  // Use API gateway instead of direct bucket access
  // Try runtime config first, then env var, then localhost fallback
  const apiBaseUrl =
    (window as any).ENV?.REACT_APP_API_URL ||
    process.env.REACT_APP_API_URL ||
    "http://localhost:8084";
  const url = `${apiBaseUrl}/activities/${year}/pacings`;
  console.log("Fetching pacing data from:", url);

  let pacingData: pacingBlobType = emptyPacingData;
  try {
    const {
      data: { pacing, upper_pacing, lower_pacing, summaries },
    } = await axios.get(url);
    console.log("Pacing data received:", pacing);
    pacingData = {
      pacing,
      upper_pacing,
      lower_pacing,
      summaries,
    };
    return pacingData;
  } catch (err) {
    console.error("Failed to fetch pacing data:", err);
  }
  return emptyPacingData;
};

export default fetchDistanceData;
