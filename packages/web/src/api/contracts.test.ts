import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { validateApiResponse, SportConfigResponseSchema } from "./contracts";
import { logger } from "../lib/logger";
import legacySportConfig from "../../../../schemas/sports/testdata/config-v1.json";

describe("validateApiResponse", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns the raw data unchanged when the schema matches", () => {
    const schema = z.object({ ok: z.boolean() });
    const data = { ok: true, extra: "passes through" };
    const result = validateApiResponse<{ ok: boolean }>(schema, data, "test");
    expect(result).toBe(data);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns raw data even on schema mismatch (observe, don't throw)", () => {
    const schema = z.object({ ok: z.boolean() });
    const data = { ok: "not a boolean" };
    const result = validateApiResponse<{ ok: boolean }>(schema, data, "fetchTest");
    expect(result).toBe(data);
  });

  it("logs a drift warning in dev mode when validation fails", () => {
    // import.meta.env.DEV defaults to true under vitest, so the validation runs.
    const schema = z.object({ requiredField: z.string() });
    const data = { wrongField: 42 };
    validateApiResponse(schema, data, "fetchExample");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[API contract drift] fetchExample"),
      expect.any(Object)
    );
  });
});

describe("SportConfigResponseSchema", () => {
  it("accepts the frozen pre-registry-change public contract", () => {
    // Go compares its real endpoint projection to this same frozen document.
    // This check keeps that response usable by the existing TypeScript client.
    expect(SportConfigResponseSchema.safeParse(legacySportConfig).success).toBe(true);
  });

  it("accepts a minimal valid sport config", () => {
    const config = {
      version: "1.0",
      sportCategories: {
        cycling: {
          displayName: "Cycling",
          stravaTypes: ["Ride"],
          excludedTypes: [],
          primaryMetric: "distance_meters",
          metrics: ["distance_meters"],
          hasDistance: true,
          hasElevation: true,
        },
      },
    };
    expect(SportConfigResponseSchema.safeParse(config).success).toBe(true);
  });

  it("accepts a sport with optional dangerPace", () => {
    const config = {
      version: "1.0",
      sportCategories: {
        cycling: {
          displayName: "Cycling",
          stravaTypes: ["Ride"],
          excludedTypes: [],
          primaryMetric: "distance_meters",
          metrics: ["distance_meters"],
          hasDistance: true,
          hasElevation: true,
          dangerPace: { valuePerDay: 20, unit: "miles" },
        },
      },
    };
    expect(SportConfigResponseSchema.safeParse(config).success).toBe(true);
  });

  it("rejects when a required field on a sport is missing", () => {
    const config = {
      version: "1.0",
      sportCategories: {
        cycling: {
          displayName: "Cycling",
          // missing stravaTypes, primaryMetric, etc.
        },
      },
    };
    expect(SportConfigResponseSchema.safeParse(config).success).toBe(false);
  });
});
