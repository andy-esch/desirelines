import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { fetchDailySummary } from "./activities";

// Mock axios but preserve AxiosError class and utility functions
vi.mock("axios", async () => {
  const actual = await vi.importActual<typeof import("axios")>("axios");
  return {
    ...actual,
    default: {
      get: vi.fn(),
      isCancel: vi.fn(),
      isAxiosError: actual.default.isAxiosError,
      Cancel: actual.default.Cancel,
    },
    AxiosError: actual.AxiosError,
  };
});

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

    vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

    const result = await fetchDailySummary({ year: 2025, sport: "cycling" });

    // The function should return just the map
    expect(result).toEqual(mockResponse.daily);
    expect(result["2025-01-01"].distanceMeters).toBe(1000);
  });

  it("should return empty object if response is empty", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: {} });

    const result = await fetchDailySummary({ year: 2025, sport: "cycling" });

    expect(result).toEqual({});
  });

  it("should include from/to params in URL when provided", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { daily: {} } });

    await fetchDailySummary({
      year: 2025,
      sport: "cycling",
      from: "2025-01-01",
      to: "2025-01-15",
    });

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("from=2025-01-01&to=2025-01-15"),
      expect.any(Object)
    );
  });
});
