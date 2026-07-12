import { z } from "zod";
import getClient from "./client";
import { throwApiError } from "./errors";
import type { MapActivity as WireMapActivity } from "../types/generated/activities";

/**
 * protojson serializes proto `int64` fields as JSON **strings** (and the apigateway
 * may serialize some as JSON **numbers**); accept either and coerce to a finite
 * number, failing loudly on anything that isn't a clean integer. This is the
 * boundary that caused the blank-map bug — a stray `Number("")`/`Number("abc")` →
 * `0`/`NaN` here silently mismatches the MVT tile's numeric ids, so we reject
 * rather than coerce to garbage.
 */
const int64ToNumber = z.union([z.number(), z.string()]).transform((v, ctx) => {
  // Single safe-integer guard for BOTH wire forms: a JSON number is taken as-is, a
  // numeric string is parsed only after the digit shape-check. `Number.isSafeInteger`
  // then rejects everything that isn't a clean int64 within ±(2^53−1) — a non-integer
  // number (e.g. 1.5), an out-of-range value that would silently round to an id the
  // tile never matches, or a NaN from a malformed/empty string — so drift fails loudly.
  const n = typeof v === "number" ? v : /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
  if (Number.isSafeInteger(n)) return n;
  ctx.addIssue({
    code: "custom",
    message: `expected an int64 (numeric string or number), got ${JSON.stringify(v)}`,
  });
  return z.NEVER;
});

/** A JSON number that must be finite — rejects `NaN`/`±Infinity` contract drift. */
const finiteNumber = z.number().refine(Number.isFinite, "must be a finite number");

/**
 * Per-region activity summary used to pick the initial map viewport and drive the
 * region filter UI. Mirrors the apigateway `RegionSummary` shape returned by
 * `GET /v1/activities/map/regions`, validated at the boundary so contract drift
 * fails loudly (the int64 blank-map bug was exactly this class of silent drift).
 */
export const RegionSummarySchema = z.object({
  /** Numeric region id from `desirelines.regions` (int64 → string or number on the wire). */
  regionId: int64ToNumber,
  name: z.string().default(""),
  /** Server-defined region granularity (e.g. "metro", "country"). */
  kind: z.string().default(""),
  activityCount: finiteNumber.default(0),
  /** [minLng, minLat, maxLng, maxLat] in WGS84 degrees — exactly four finite numbers. */
  bbox: z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber]),
});
export type RegionSummary = z.infer<typeof RegionSummarySchema>;

export const RouteRegionsResponseSchema = z.object({
  /** Densest-first; drives the region filter UI. */
  regions: z.array(RegionSummarySchema).default([]),
  /**
   * Server-chosen region to fit on load (densest of the highest-priority kind),
   * or `null` when the user has no geo-bearing activities.
   */
  defaultViewport: RegionSummarySchema.nullable().default(null),
});
export type RouteRegionsResponse = z.infer<typeof RouteRegionsResponseSchema>;

/**
 * A geo-bearing activity in the routes-map cross-filter dataset, as the client uses
 * it: the generated `MapActivity` wire shape (from `activities.proto`) parsed through
 * `zod`, with its protojson `int64`-as-string ids (`activityId`, `regionIds`) coerced
 * to **numbers** — so they match the MVT tile's numeric `activity_id` (map
 * cross-filter) and the numeric `RegionSummary.regionId`. protojson omits zero/empty
 * fields, so the schema restores their defaults (`""`/`0`/`[]`); `elevationMeters`
 * and `bbox` stay optional (absent without a value / route geometry).
 *
 * Note: `sport` is the **app category** (e.g. `cycling`, `running`) — unlike the MVT
 * tile's `sport` property (raw Strava sport_type). Cross-filtering the map therefore
 * keys on the filtered `activityId` set, not the tile `sport`.
 */
export const MapActivitySchema = z.object({
  /** Strava activity id, coerced from the protojson string to a number. */
  activityId: int64ToNumber,
  /** Activity name/title (for the cross-filter list + click popover). */
  name: z.string().default(""),
  /** App sport category (cycling, running, …). */
  sport: z.string().default(""),
  /** Distance in meters. */
  distanceMeters: finiteNumber.default(0),
  /** Moving time in seconds. */
  movingTime: finiteNumber.default(0),
  /** Elevation gain in meters (absent when null on the wire). */
  elevationMeters: finiteNumber.optional(),
  /** Local start time, ISO 8601. */
  startDateLocal: z.string().default(""),
  /** Region ids, coerced to numbers to match `RegionSummary.regionId`. */
  regionIds: z.array(int64ToNumber).default([]),
  /** [minLng, minLat, maxLng, maxLat] route bbox; absent without geometry. */
  bbox: z.array(finiteNumber).optional(),
});
export type MapActivity = z.infer<typeof MapActivitySchema>;

// Compile-time reconciliation with the generated proto type (do not delete): the
// parsed app shape must stay mutually assignable with the generated `WireMapActivity`
// — its int64 ids widened string→number and `bbox` made optional. A proto change that
// renames or retypes a field changes `WireMapActivity` and breaks one of these
// assignments, surfacing the drift instead of silently double-maintaining the shape.
type _AppMapActivity = Omit<WireMapActivity, "activityId" | "regionIds" | "bbox"> & {
  activityId: number;
  regionIds: number[];
  bbox?: number[] | undefined;
};
const _reconcileMapActivity = (x: MapActivity): _AppMapActivity => x;
const _reconcileMapActivityReverse = (x: _AppMapActivity): MapActivity => x;
void [_reconcileMapActivity, _reconcileMapActivityReverse];

/** Wrapper for `GET /v1/activities/map/dataset` (no pagination — see `fetchMapDataset`). */
export const MapDatasetResponseSchema = z.object({
  activities: z.array(MapActivitySchema).default([]),
});

/**
 * Fetch the full geo-bearing activity dataset for the routes-map cross-filter
 * model (all scalars + region tags + optional bbox, keyed by activity id). Not
 * paginated — single user, hundreds–low-thousands of rows. Auth + trace headers
 * are attached by the shared axios client interceptor.
 *
 * `protojson` serializes the proto `int64` fields (`activityId`, `regionIds`) as
 * JSON **strings** — `MapDatasetResponseSchema` is the single boundary that parses
 * the response, coercing those ids to numbers and rejecting malformed rows so
 * contract drift fails loudly (via `throwApiError`) instead of silently producing a
 * `NaN` id that never matches the tile.
 */
export const fetchMapDataset = async (signal?: AbortSignal): Promise<MapActivity[]> => {
  try {
    const { data } = await getClient().get<unknown>(
      "activities/map/dataset",
      signal ? { signal } : {}
    );
    return MapDatasetResponseSchema.parse(data ?? {}).activities;
  } catch (err: unknown) {
    throwApiError(err, "fetchMapDataset");
  }
};

/**
 * Fetch the per-region summary + default viewport for the routes map. The response
 * is parsed through `RouteRegionsResponseSchema` (same boundary-validation rationale
 * as `fetchMapDataset`): region ids are coerced to numbers, `bbox` is enforced as
 * four finite numbers, and a missing/partial body falls back to safe defaults.
 * Auth + trace headers are attached by the shared axios client interceptor.
 */
export const fetchRouteRegions = async (signal?: AbortSignal): Promise<RouteRegionsResponse> => {
  try {
    const { data } = await getClient().get<unknown>(
      "activities/map/regions",
      signal ? { signal } : {}
    );
    return RouteRegionsResponseSchema.parse(data ?? {});
  } catch (err: unknown) {
    throwApiError(err, "fetchRouteRegions");
  }
};

/** The zoom levels the routes map needs, sourced from the backend's TileJSON so the
 *  two can't drift on these magic numbers. `lineMinZoom` is the LOD switch (route
 *  lines at/above it, density dots below). */
export interface MapTileJSON {
  minZoom: number;
  maxZoom: number;
  lineMinZoom: number;
}

/** Defaults matching the backend (repository.Tile*Zoom) — used until the TileJSON
 *  resolves, and if the field is absent, so the map always renders sensibly. */
export const DEFAULT_TILE_META: MapTileJSON = { minZoom: 0, maxZoom: 14, lineMinZoom: 8 };

const TileJSONResponseSchema = z.object({
  minzoom: z.number().default(DEFAULT_TILE_META.minZoom),
  maxzoom: z.number().default(DEFAULT_TILE_META.maxZoom),
  vector_layers: z.array(z.object({ id: z.string(), minzoom: z.number().optional() })).default([]),
});

/**
 * Fetch the routes-map TileJSON and reduce it to the zoom levels the client needs.
 * Only the zoom fields are consumed — the client builds its own origin-aware tile
 * URL (Firebase Hosting rewrites), so the doc's `tiles` template is ignored here.
 * `lineMinZoom` comes from the `routes` vector layer's minzoom.
 */
export const fetchMapTileJSON = async (signal?: AbortSignal): Promise<MapTileJSON> => {
  try {
    const { data } = await getClient().get<unknown>(
      "activities/map/tiles.json",
      signal ? { signal } : {}
    );
    const parsed = TileJSONResponseSchema.parse(data ?? {});
    const routes = parsed.vector_layers.find((l) => l.id === "routes");
    return {
      minZoom: parsed.minzoom,
      maxZoom: parsed.maxzoom,
      lineMinZoom: routes?.minzoom ?? DEFAULT_TILE_META.lineMinZoom,
    };
  } catch (err: unknown) {
    throwApiError(err, "fetchMapTileJSON");
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
