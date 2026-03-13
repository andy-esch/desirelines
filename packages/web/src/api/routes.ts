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

export interface RouteRing {
  radiusMeters: number;
  coords: number[][];
}

export interface RoutesResponse {
  routes: NormalizedRoute[];
  rings?: RouteRing[];
}

export interface FetchRoutesOptions {
  limit?: number;
  /** Ring radii in meters. If provided, rings are computed by the backend. */
  ringMeters?: number[];
  signal?: AbortSignal;
}

export const fetchRoutes = async (options: FetchRoutesOptions = {}): Promise<RoutesResponse> => {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set("limit", options.limit.toString());
  }
  if (options.ringMeters && options.ringMeters.length > 0) {
    params.set("rings", options.ringMeters.join(","));
  }

  const query = params.toString();
  const url = `activities/routes${query ? `?${query}` : ""}`;

  try {
    const { data } = await getClient().get<RoutesResponse>(url, {
      signal: options.signal,
    });
    return data ?? { routes: [] };
  } catch (err: unknown) {
    throwApiError(err, "fetchRoutes");
  }
};
