/**
 * API Response Contracts
 *
 * Zod schemas for the public API responses consumed in `activities.ts`. The
 * schemas are intentionally **loose** — they validate only the structural
 * fields the frontend actually reads, not every proto-defined field. The
 * goal is to catch contract drift (a renamed field, a type that flipped from
 * array to object), not to enforce wire format exhaustively.
 *
 * Validation runs **only in development** (`import.meta.env.DEV`) so there is
 * zero production overhead. Failures are logged via `logger.warn` and the
 * raw data is returned anyway — we observe drift loudly without breaking
 * the user's session if a backend deploys an unexpected response.
 */

import { z } from "zod";
import { logger } from "../lib/logger";

/**
 * Run a Zod schema against an API response in dev only, log on failure,
 * and pass the data through unchanged. Designed to surface backend contract
 * drift during local development without ever blocking a real user.
 */
export function validateApiResponse<T>(schema: z.ZodSchema, data: unknown, endpoint: string): T {
  if (import.meta.env.DEV) {
    const result = schema.safeParse(data);
    if (!result.success) {
      logger.warn(
        `[API contract drift] ${endpoint} response failed schema validation:`,
        result.error.format()
      );
    }
  }
  // Return the original data — schemas here observe, they don't transform.
  return data as T;
}

// =============================================================================
// Endpoint schemas
//
// Each schema covers the fields the frontend actually reads. `.passthrough()`
// keeps additional/unknown fields from triggering false positives — we only
// want to know when a field we *use* changes shape.
// =============================================================================

const MetricsEntrySchema = z
  .object({
    date: z.string(),
    distance: z.number().optional(),
    time: z.number().optional(),
    elevation: z.number().optional(),
    activities: z.number().optional(),
  })
  .passthrough();

export const SportMetricsResponseSchema = z
  .object({
    timeseries: z.array(MetricsEntrySchema).optional(),
  })
  .passthrough();

export const YearMetadataResponseSchema = z
  .object({
    sports: z.array(z.string()).optional(),
    totals: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const SportCategorySchema = z
  .object({
    displayName: z.string(),
    stravaTypes: z.array(z.string()),
    excludedTypes: z.array(z.string()),
    primaryMetric: z.string(),
    metrics: z.array(z.string()),
    hasDistance: z.boolean(),
    hasElevation: z.boolean(),
    dangerPace: z
      .object({
        valuePerDay: z.number(),
        unit: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const SportConfigResponseSchema = z
  .object({
    version: z.string(),
    sportCategories: z.record(z.string(), SportCategorySchema),
  })
  .passthrough();

const SportBucketSchema = z
  .object({
    daily: z.record(z.string(), z.unknown()).optional(),
    timeseries: z.array(MetricsEntrySchema).optional(),
  })
  .passthrough();

export const AllSportsDailySummaryResponseSchema = z
  .object({
    bySport: z.record(z.string(), SportBucketSchema).optional(),
  })
  .passthrough();

export const AllSportsMetricsResponseSchema = z
  .object({
    bySport: z.record(z.string(), SportBucketSchema).optional(),
  })
  .passthrough();

// Activity has many fields; just spot-check the ones the UI reads at the top
// level. The list endpoint shape is also intentionally loose.
const ActivitySchema = z
  .object({
    id: z.number(),
    name: z.string().optional(),
    sport: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

export const ActivityResponseSchema = ActivitySchema;

export const ActivityListResponseSchema = z
  .object({
    activities: z.array(ActivitySchema).optional(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  })
  .passthrough();
