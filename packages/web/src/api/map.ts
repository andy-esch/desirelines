import getClient from "./client";
import { throwApiError } from "./errors";

/**
 * Per-region activity summary used to pick the initial map viewport and (in a
 * follow-on task) drive a region filter UI. Mirrors the apigateway
 * `RegionSummary` shape returned by `GET /v1/activities/map/regions`.
 */
export interface RegionSummary {
  /** Numeric region id from `desirelines.regions` (apigateway serializes int64 → JSON number). */
  regionId: number;
  name: string;
  /** Server-defined region granularity (e.g. "metro", "country"). */
  kind: string;
  activityCount: number;
  /** [minLng, minLat, maxLng, maxLat] in WGS84 degrees. */
  bbox: [number, number, number, number];
}

export interface RouteRegionsResponse {
  /** Densest-first; for the future region filter UI. */
  regions: RegionSummary[];
  /**
   * Server-chosen region to fit on load (densest of the highest-priority kind),
   * or `null` when the user has no geo-bearing activities.
   */
  defaultViewport: RegionSummary | null;
}

/**
 * Fetch the per-region summary + default viewport for the routes map.
 * Auth + trace headers are attached by the shared axios client interceptor.
 */
export const fetchRouteRegions = async (signal?: AbortSignal): Promise<RouteRegionsResponse> => {
  try {
    const { data } = await getClient().get<RouteRegionsResponse>(
      "activities/map/regions",
      signal ? { signal } : {}
    );
    return {
      regions: data?.regions ?? [],
      defaultViewport: data?.defaultViewport ?? null,
    };
  } catch (err: unknown) {
    throwApiError(err, "fetchRouteRegions");
  }
};

/**
 * Build the absolute MVT tile template URL for a Mapbox `vector` source.
 *
 * Mapbox requires literal `{z}/{x}/{y}` placeholders and an absolute URL, so we
 * resolve a relative `VITE_API_GATEWAY_URL` (e.g. `/api`, used behind Firebase
 * Hosting rewrites) against the app origin by hand — the `URL()` constructor
 * would percent-encode the braces and break tile fetching.
 *
 * @param apiGatewayUrl - configured gateway base (absolute `http(s)://…` or a
 *   same-origin path like `/api`); the axios client's `/v1` suffix is mirrored.
 * @param origin - app origin (`window.location.origin`).
 */
function resolveAbsoluteGateway(apiGatewayUrl: string, origin: string): string {
  // Normalize a trailing slash so a gateway like "/api/" doesn't yield "//v1".
  const normalized = apiGatewayUrl.replace(/\/+$/, "");
  // Resolve a same-origin path (e.g. "/api", used behind Firebase Hosting
  // rewrites) to an absolute URL.
  return normalized.startsWith("/") ? `${origin}${normalized}` : normalized;
}

export function buildTileTemplateUrl(apiGatewayUrl: string, origin: string): string {
  return `${resolveAbsoluteGateway(apiGatewayUrl, origin)}/v1/activities/map/tiles/{z}/{x}/{y}`;
}

/**
 * Build the absolute `${gateway}/v1` base used to classify internal tile requests
 * in Mapbox's `transformRequest`.
 *
 * Must be ABSOLUTE: Mapbox resolves tile URLs to absolute before requesting them,
 * and `isInternalRequest` compares against this base — a relative base (e.g.
 * "/api/v1") risks misclassifying internal tile requests as external and dropping
 * the Firebase auth header (→ 401). Mirrors `buildTileTemplateUrl`'s resolution.
 */
export function buildApiBaseUrl(apiGatewayUrl: string, origin: string): string {
  return `${resolveAbsoluteGateway(apiGatewayUrl, origin)}/v1`;
}
