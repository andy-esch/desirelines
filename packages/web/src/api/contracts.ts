/**
 * API Response Contracts
 *
 * Loose Zod schemas for the public API responses consumed in `activities.ts`.
 * Schemas validate only the structural fields the frontend reads — every
 * object uses `.passthrough()` so unknown fields don't trigger false
 * positives. The goal is contract-drift detection (renamed fields, types
 * that flipped from array to object), not exhaustive wire-format enforcement.
 */

import { z } from "zod";
import { logger } from "../lib/logger";

/**
 * Run a schema against an API response in dev only, log on failure, and pass
 * the data through unchanged. Surfaces backend contract drift during local
 * development without ever blocking a real user; zero production overhead.
 *
 * The `as T` cast is intentionally unchecked — the proto-generated type is
 * the source of truth, the schema is a loose runtime sentinel. They share
 * the same structural shape but TypeScript can't prove it from a Zod schema
 * alone.
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
  return data as T;
}

// ---------------------------------------------------------------------------
// Endpoint schemas — one per public function in `activities.ts`.
// ---------------------------------------------------------------------------

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
        warnAtFraction: z.number().min(0).max(1).optional(),
      })
      .passthrough()
      .optional(),
    goalDefaults: z
      .object({
        increment: z.number().optional(),
        rounding: z.number().optional(),
        defaultValue: z.number().optional(),
        chartIntervals: z
          .array(
            z
              .object({
                max: z.number().optional(),
                interval: z.number(),
              })
              .passthrough()
          )
          .optional(),
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

// Activity has many fields; spot-check the top-level shape only.
const ActivitySchema = z
  .object({
    id: z.number(),
    name: z.string().optional(),
    sport: z.string().optional(),
    type: z.string().optional(),
    // Present on ActivitySummary (list responses); gates the "view on map"
    // affordance. Absent on the full Activity (GET /activities/{id}).
    hasRoute: z.boolean().optional(),
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
