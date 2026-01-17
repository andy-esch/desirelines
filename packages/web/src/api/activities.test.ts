import { describe, it, expect, vi, beforeEach } from "vitest";
import client from "./client";
import { fetchDailySummary } from "./activities";

// Mock the API client
vi.mock("./client", () => ({
  default: {
    get: vi.fn(),
  },
}));

describe("fetchDailySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return unwrapped daily map from wrapped response", async () => {
    // The API returns { daily: { ... } }
    const mockResponse = {
      daily: {
        "2025-01-01": {
          distanceMeters: 1000,
          activities: 1,
          activityIds: [123],
        },
      },
    };

    vi.mocked(client.get).mockResolvedValue({ data: mockResponse });

    const result = await fetchDailySummary({ year: 2025, sport: "cycling" });

    // The function should return just the map
    expect(result).toEqual(mockResponse.daily);
    expect(result["2025-01-01"].distanceMeters).toBe(1000);
  });

  it("should return empty object if response is empty", async () => {
    vi.mocked(client.get).mockResolvedValue({ data: {} });

    const result = await fetchDailySummary({ year: 2025, sport: "cycling" });

    expect(result).toEqual({});
  });

  it("should include from/to params in URL when provided", async () => {
    vi.mocked(client.get).mockResolvedValue({ data: { daily: {} } });

    await fetchDailySummary({
      year: 2025,
      sport: "cycling",
      from: "2025-01-01",
      to: "2025-01-15",
    });

    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining("from=2025-01-01&to=2025-01-15"),
      expect.any(Object)
    );
  });
});
