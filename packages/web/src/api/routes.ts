import getClient from "./client";
import { throwApiError } from "./errors";

/** Backend default limit for route fetching (matches repository.DefaultRoutesLimit) */
export const ROUTES_LIMIT = 500;

export interface NormalizedRoute {
  activityId: number;
  name: string;
  sport: string;
  distance: number;
  date: string;
  coords: number[][];
}

export interface FetchRoutesOptions {
  limit?: number;
  signal?: AbortSignal;
}

export const fetchRoutes = async (options: FetchRoutesOptions = {}): Promise<NormalizedRoute[]> => {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set("limit", options.limit.toString());
  }

  const query = params.toString();
  const url = `activities/routes${query ? `?${query}` : ""}`;

  try {
    const { data } = await getClient().get<NormalizedRoute[]>(url, {
      signal: options.signal,
    });
    return data ?? [];
  } catch (err: unknown) {
    throwApiError(err, "fetchRoutes");
  }
};
