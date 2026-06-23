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
 * A single geo-bearing activity in the routes-map cross-filter dataset: scalar
 * attributes + region tag ids keyed by `activityId`. Mirrors the apigateway
 * `MapActivity` shape from `GET /v1/activities/map/dataset`. This is the shared
 * client-side model that drives the map (`setFilter`), charts/KPIs, and the
 * activity list — all client-side, no per-filter refetch.
 *
 * Note: `sport` is the **app category** (e.g. `cycling`, `running`) — unlike the
 * MVT tile's `sport` property, which is the raw Strava sport_type. Cross-filtering
 * the map therefore keys on the filtered `activityId` set, not the tile `sport`.
 */
export interface MapActivity {
  activityId: number;
  /** Activity name/title (for the activity list + click popover). */
  name: string;
  /** App sport category (e.g. `cycling`, `running`). */
  sport: string;
  distanceMeters: number;
  /** Moving time in seconds. */
  movingTime: number;
  /** Elevation gain in meters; absent when unknown. */
  elevationMeters?: number;
  /** Local start time (athlete local time), ISO 8601. */
  startDateLocal: string;
  /** Region ids this activity is tagged to — same ids as `/map/regions`. */
  regionIds: number[];
  /** Optional [minLng, minLat, maxLng, maxLat] from the route geometry. */
  bbox?: [number, number, number, number];
}

export interface MapDatasetResponse {
  activities: MapActivity[];
}

/**
 * Fetch the full geo-bearing activity dataset for the routes-map cross-filter
 * model (all scalars + region tags + optional bbox, keyed by activity id). Not
 * paginated — single user, hundreds–low-thousands of rows. Auth + trace headers
 * are attached by the shared axios client interceptor.
 */
/**
 * Wire shape of the dataset response. `protojson` serializes the proto `int64`
 * fields (`activityId`, `regionIds`) as JSON **strings**, so they arrive as
 * strings and must be parsed to numbers — otherwise the map cross-filter's
 * `["in", ["get","activity_id"], …]` compares strings against the MVT tile's
 * numeric `activity_id` and matches nothing.
 */
interface RawMapActivity extends Omit<MapActivity, "activityId" | "regionIds"> {
  activityId: string | number;
  regionIds: (string | number)[];
}

export const fetchMapDataset = async (signal?: AbortSignal): Promise<MapActivity[]> => {
  try {
    const { data } = await getClient().get<{ activities?: RawMapActivity[] }>(
      "activities/map/dataset",
      signal ? { signal } : {}
    );
    // Coerce the protojson int64-as-string ids back to numbers so they match the
    // tile's numeric `activity_id` (map cross-filter) and RegionSummary.regionId.
    return (data?.activities ?? []).map((a) => ({
      ...a,
      activityId: Number(a.activityId),
      regionIds: (a.regionIds ?? []).map(Number),
    }));
  } catch (err: unknown) {
    throwApiError(err, "fetchMapDataset");
  }
};

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
