import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios, { AxiosError } from "axios";
import { fetchDistanceData } from "./activities";
import { EMPTY_RIDE_DATA } from "../constants";

// Mock axios but preserve AxiosError class
vi.mock("axios", async () => {
  const actual = await vi.importActual<typeof import("axios")>("axios");
  return {
    ...actual,
    default: {
      get: vi.fn(),
      isCancel: vi.fn(),
      Cancel: actual.default.Cancel,
    },
    AxiosError: actual.AxiosError,
  };
});

describe("fetchDistanceData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear window.ENV before each test
    delete (window as any).ENV;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("API URL resolution", () => {
    it("should use configured API_BASE_URL from config", async () => {
      // API_BASE_URL is set from import.meta.env.VITE_API_GATEWAY_URL at module load time
      // In tests, it will use the default fallback (localhost:8084)
      const mockData = {
        distance_traveled: [{ x: "2025-01-01", y: 10 }],
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      await fetchDistanceData(2025);

      // Verify the URL was called (exact URL depends on env configuration)
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/activities/2025/distances"),
        expect.any(Object)
      );
    });

    it("should fall back to localhost:8084 when API_BASE_URL is not configured", async () => {
      // When VITE_API_GATEWAY_URL is not set, defaults to localhost:8084
      const mockData = {
        distance_traveled: [{ x: "2025-01-01", y: 10 }],
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      await fetchDistanceData(2025);

      // In test environment without env vars, should use default
      expect(axios.get).toHaveBeenCalledWith(
        "http://localhost:8084/activities/2025/distances",
        expect.any(Object)
      );
    });
  });

  describe("successful data fetch", () => {
    it("should return ride data when API call succeeds", async () => {
      const mockData = {
        distance_traveled: [
          { x: "2025-01-01", y: 10 },
          { x: "2025-01-02", y: 20 },
        ],
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const result = await fetchDistanceData(2025);

      expect(result).toEqual(mockData);
    });

    it("should pass AbortSignal to axios when provided", async () => {
      const mockData = {
        distance_traveled: [],
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const abortController = new AbortController();
      await fetchDistanceData(2025, abortController.signal);

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/activities/2025/distances"),
        { signal: abortController.signal }
      );
    });

    it("should construct correct URL with year parameter", async () => {
      const mockData = {
        distance_traveled: [],
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      await fetchDistanceData(2023);

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/activities/2023/distances"),
        expect.any(Object)
      );
    });
  });

  describe("request cancellation", () => {
    it("should return EMPTY_RIDE_DATA when request is cancelled", async () => {
      // Simulate axios cancel error
      const cancelError = new axios.Cancel("Request cancelled");
      vi.mocked(axios.get).mockRejectedValue(cancelError);
      vi.mocked(axios.isCancel).mockReturnValue(true);

      const result = await fetchDistanceData(2025);

      expect(result).toEqual(EMPTY_RIDE_DATA);
    });

    it("should not log error when request is cancelled (expected behavior)", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cancelError = new axios.Cancel("Request cancelled");
      vi.mocked(axios.get).mockRejectedValue(cancelError);
      vi.mocked(axios.isCancel).mockReturnValue(true);

      await fetchDistanceData(2025);

      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("404 handling (no data for year)", () => {
    it("should return EMPTY_RIDE_DATA for 404 response (year has no data)", async () => {
      // Create a real AxiosError instance
      const error = new AxiosError(
        "Request failed with status code 404",
        "ERR_BAD_REQUEST",
        {} as any,
        {},
        {
          status: 404,
          statusText: "Not Found",
          headers: {},
          config: {} as any,
          data: null,
        }
      );

      vi.mocked(axios.get).mockRejectedValue(error);

      const result = await fetchDistanceData(2025);

      expect(result).toEqual(EMPTY_RIDE_DATA);
    });

    it("should not log error for 404 (no data is a valid state)", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const error = new AxiosError(
        "Request failed with status code 404",
        "ERR_BAD_REQUEST",
        {} as any,
        {},
        {
          status: 404,
          statusText: "Not Found",
          headers: {},
          config: {} as any,
          data: null,
        }
      );

      vi.mocked(axios.get).mockRejectedValue(error);

      await fetchDistanceData(2025);

      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("network and server errors", () => {
    it("should throw error and log for 500 server error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const error = Object.assign(new Error("Request failed with status code 500"), {
        isAxiosError: true,
        response: {
          status: 500,
          statusText: "Internal Server Error",
          headers: {},
          config: {} as any,
          data: null,
        },
        name: "AxiosError",
        config: {} as any,
        toJSON: () => ({}),
      }) as AxiosError;

      vi.mocked(axios.get).mockRejectedValue(error);

      await expect(fetchDistanceData(2025)).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to fetch distance data:",
        "Request failed with status code 500"
      );

      consoleErrorSpy.mockRestore();
    });

    it("should throw error for network failure", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const networkError = new Error("Network Error");
      vi.mocked(axios.get).mockRejectedValue(networkError);

      await expect(fetchDistanceData(2025)).rejects.toThrow("Network Error");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to fetch distance data:",
        "Network Error"
      );

      consoleErrorSpy.mockRestore();
    });

    it("should throw error for 401 Unauthorized", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const error = Object.assign(new Error("Request failed with status code 401"), {
        isAxiosError: true,
        response: {
          status: 401,
          statusText: "Unauthorized",
          headers: {},
          config: {} as any,
          data: null,
        },
        name: "AxiosError",
        config: {} as any,
        toJSON: () => ({}),
      }) as AxiosError;

      vi.mocked(axios.get).mockRejectedValue(error);

      await expect(fetchDistanceData(2025)).rejects.toThrow();

      consoleErrorSpy.mockRestore();
    });

    it("should throw error for 403 Forbidden", async () => {
      const error = Object.assign(new Error("Request failed with status code 403"), {
        isAxiosError: true,
        response: {
          status: 403,
          statusText: "Forbidden",
          headers: {},
          config: {} as any,
          data: null,
        },
        name: "AxiosError",
        config: {} as any,
        toJSON: () => ({}),
      }) as AxiosError;

      vi.mocked(axios.get).mockRejectedValue(error);

      await expect(fetchDistanceData(2025)).rejects.toThrow();
    });

    it("should handle non-Error objects and convert to Error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Reject with a string instead of an Error object
      vi.mocked(axios.get).mockRejectedValue("Something went wrong");

      await expect(fetchDistanceData(2025)).rejects.toThrow("Something went wrong");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle empty response data", async () => {
      const mockData = {
        distance_traveled: [],
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const result = await fetchDistanceData(2025);

      expect(result).toEqual(mockData);
    });

    it("should handle distance data with multiple entries", async () => {
      const mockData = {
        distance_traveled: [
          { x: "2025-01-01", y: 100 },
          { x: "2025-01-02", y: 150 },
          { x: "2025-01-03", y: 175 },
        ],
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const result = await fetchDistanceData(2025);

      expect(result.distance_traveled).toHaveLength(3);
      expect(result.distance_traveled[0]).toEqual({ x: "2025-01-01", y: 100 });
      expect(result.distance_traveled[2]).toEqual({ x: "2025-01-03", y: 175 });
    });
  });
});
