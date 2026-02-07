import { describe, it, expect } from "vitest";
import { boxMuller, logNormal, poisson } from "./distributions";

const SAMPLE_SIZE = 10_000;

describe("boxMuller", () => {
  it("produces values with mean ≈ 0 and variance ≈ 1", () => {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const [z1, z2] = boxMuller();
      samples.push(z1, z2);
    }

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance =
      samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / samples.length;

    expect(mean).toBeCloseTo(0, 1); // within 0.05 of 0
    expect(variance).toBeCloseTo(1, 0); // within 0.5 of 1
  });

  it("returns a tuple of two numbers", () => {
    const result = boxMuller();
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe("number");
    expect(typeof result[1]).toBe("number");
  });
});

describe("logNormal", () => {
  it("sample mean ≈ target mean over many samples", () => {
    const targetMean = 100;
    const sigma = 0.4;
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      samples.push(logNormal(targetMean, sigma));
    }

    const sampleMean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Allow 10% tolerance for statistical variation
    expect(sampleMean).toBeGreaterThan(targetMean * 0.9);
    expect(sampleMean).toBeLessThan(targetMean * 1.1);
  });

  it("all values are positive", () => {
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      expect(logNormal(50, 0.5)).toBeGreaterThan(0);
    }
  });

  it("returns mean exactly when sigma = 0", () => {
    expect(logNormal(42, 0)).toBe(42);
    expect(logNormal(100, 0)).toBe(100);
  });

  it("returns 0 when mean <= 0", () => {
    expect(logNormal(0, 0.5)).toBe(0);
    expect(logNormal(-10, 0.5)).toBe(0);
  });

  it("higher sigma produces wider spread", () => {
    const tightSamples: number[] = [];
    const wideSamples: number[] = [];
    const mean = 100;

    for (let i = 0; i < SAMPLE_SIZE; i++) {
      tightSamples.push(logNormal(mean, 0.2));
      wideSamples.push(logNormal(mean, 0.8));
    }

    const tightMean = tightSamples.reduce((a, b) => a + b, 0) / tightSamples.length;
    const wideMean = wideSamples.reduce((a, b) => a + b, 0) / wideSamples.length;

    const tightVariance =
      tightSamples.reduce((sum, x) => sum + (x - tightMean) ** 2, 0) / tightSamples.length;
    const wideVariance =
      wideSamples.reduce((sum, x) => sum + (x - wideMean) ** 2, 0) / wideSamples.length;

    expect(wideVariance).toBeGreaterThan(tightVariance);
  });
});

describe("poisson", () => {
  it("sample mean ≈ lambda over many samples", () => {
    const lambda = 4;
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      samples.push(poisson(lambda));
    }

    const sampleMean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(sampleMean).toBeGreaterThan(lambda * 0.9);
    expect(sampleMean).toBeLessThan(lambda * 1.1);
  });

  it("all values are non-negative integers", () => {
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const val = poisson(3);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it("returns 0 when lambda = 0", () => {
    expect(poisson(0)).toBe(0);
  });

  it("returns 0 for negative lambda", () => {
    expect(poisson(-5)).toBe(0);
  });

  it("works with small lambda values", () => {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      samples.push(poisson(0.5));
    }

    const sampleMean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(sampleMean).toBeGreaterThan(0.3);
    expect(sampleMean).toBeLessThan(0.7);
  });
});
