import { afterEach, describe, it, expect, vi } from "vitest";
import { isNotFound } from "@tanstack/react-router";

describe("/dev/themes route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("answers not-found outside development", async () => {
    vi.stubEnv("DEV", false);
    const { Route } = await import("../../routes/dev/themes");

    let thrown: unknown;
    try {
      Route.options.beforeLoad?.({} as never);
    } catch (error) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
  });

  it("loads in development", async () => {
    vi.stubEnv("DEV", true);
    const { Route } = await import("../../routes/dev/themes");

    expect(() => Route.options.beforeLoad?.({} as never)).not.toThrow();
  });
});
