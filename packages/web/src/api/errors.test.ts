import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios, { type AxiosError } from "axios";
import {
  isCancellationError,
  isAuthError,
  isRetryableError,
  is404Error,
  createAuthError,
  logApiError,
  throwApiError,
  redactAuthorizationHeader,
} from "./errors";

describe("API Error Utilities", () => {
  describe("isCancellationError", () => {
    it("should return true for axios.CancelToken cancellation", () => {
      const cancelError = new axios.Cancel("Operation canceled");
      expect(isCancellationError(cancelError)).toBe(true);
    });

    it("should return true for AbortController abort", () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      expect(isCancellationError(abortError)).toBe(true);
    });

    it("should return true for legacy 'Request cancelled' error message", () => {
      const legacyError = new Error("Request cancelled");
      expect(isCancellationError(legacyError)).toBe(true);
    });

    it("should return false for regular errors", () => {
      const regularError = new Error("Network error");
      expect(isCancellationError(regularError)).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isCancellationError(null)).toBe(false);
      expect(isCancellationError(undefined)).toBe(false);
    });

    it("should return false for non-Error objects", () => {
      expect(isCancellationError("error string")).toBe(false);
      expect(isCancellationError({ message: "error" })).toBe(false);
    });

    it("should return false for DOMException with different name", () => {
      const otherDomError = new DOMException("Some error", "NotFoundError");
      expect(isCancellationError(otherDomError)).toBe(false);
    });
  });

  describe("isAuthError", () => {
    it("should return true for 401 Unauthorized", () => {
      const error = createAxiosError(401);
      expect(isAuthError(error)).toBe(true);
    });

    it("should return true for 403 Forbidden", () => {
      const error = createAxiosError(403);
      expect(isAuthError(error)).toBe(true);
    });

    it("should return false for 404 Not Found", () => {
      const error = createAxiosError(404);
      expect(isAuthError(error)).toBe(false);
    });

    it("should return false for 500 Internal Server Error", () => {
      const error = createAxiosError(500);
      expect(isAuthError(error)).toBe(false);
    });

    it("should return false for regular errors", () => {
      const error = new Error("Not an axios error");
      expect(isAuthError(error)).toBe(false);
    });

    it("should return false for network errors (no response)", () => {
      const error = Object.assign(new Error("Network Error"), {
        isAxiosError: true,
        name: "AxiosError",
        config: {} as any,
        toJSON: () => ({}),
      }) as AxiosError;
      expect(isAuthError(error)).toBe(false);
    });
  });

  describe("isRetryableError", () => {
    it("should return true for network errors (no response)", () => {
      const error = Object.assign(new Error("Network Error"), {
        isAxiosError: true,
        name: "AxiosError",
        config: {} as any,
        toJSON: () => ({}),
      }) as AxiosError;
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for 500 Internal Server Error", () => {
      const error = createAxiosError(500);
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for 502 Bad Gateway", () => {
      const error = createAxiosError(502);
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for 503 Service Unavailable", () => {
      const error = createAxiosError(503);
      expect(isRetryableError(error)).toBe(true);
    });

    it("should return false for 400 Bad Request", () => {
      const error = createAxiosError(400);
      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for 401 Unauthorized", () => {
      const error = createAxiosError(401);
      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for 404 Not Found", () => {
      const error = createAxiosError(404);
      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for regular errors", () => {
      const error = new Error("Regular error");
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe("is404Error", () => {
    it("should return true for 404 Not Found", () => {
      const error = createAxiosError(404);
      expect(is404Error(error)).toBe(true);
    });

    it("should return false for other status codes", () => {
      expect(is404Error(createAxiosError(400))).toBe(false);
      expect(is404Error(createAxiosError(401))).toBe(false);
      expect(is404Error(createAxiosError(500))).toBe(false);
    });

    it("should return false for non-axios errors", () => {
      expect(is404Error(new Error("Not found"))).toBe(false);
      expect(is404Error(null)).toBe(false);
    });
  });

  describe("throwApiError", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("should throw auth error for 401", () => {
      const error = createAxiosError(401);
      expect(() => throwApiError(error, "testFunc")).toThrow(
        "Access denied. Please sign in with an authorized account."
      );
    });

    it("should throw auth error for 403", () => {
      const error = createAxiosError(403);
      expect(() => throwApiError(error, "testFunc")).toThrow(
        "Access denied. Please sign in with an authorized account."
      );
    });

    it("should throw original error for non-auth errors", () => {
      const error = new Error("Network failure");
      expect(() => throwApiError(error, "testFunc")).toThrow("Network failure");
    });

    it("should convert non-Error to Error", () => {
      expect(() => throwApiError("string error", "testFunc")).toThrow("string error");
    });

    it("should log error before throwing", () => {
      const error = new Error("Some error");
      try {
        throwApiError(error, "testFunc");
      } catch {
        // Expected
      }
      expect(consoleErrorSpy).toHaveBeenCalledWith("testFunc:", "Some error");
    });
  });

  describe("createAuthError", () => {
    it("should return an Error with access denied message", () => {
      const error = createAuthError();
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Access denied. Please sign in with an authorized account.");
    });
  });

  describe("redactAuthorizationHeader", () => {
    it("should delete the Authorization header from an Axios error config", () => {
      const error = createAxiosError(500);
      error.config = {
        headers: { Authorization: "Bearer secret-token", "X-Other": "keep" },
      } as any;

      redactAuthorizationHeader(error);

      expect(error.config?.headers?.Authorization).toBeUndefined();
      expect(error.config?.headers?.["X-Other"]).toBe("keep");
    });

    it("should be a no-op for non-Axios errors", () => {
      const error = new Error("not axios");
      expect(() => redactAuthorizationHeader(error)).not.toThrow();
    });

    it("should be a no-op for null/undefined", () => {
      expect(() => redactAuthorizationHeader(null)).not.toThrow();
      expect(() => redactAuthorizationHeader(undefined)).not.toThrow();
    });

    it("should be a no-op for Axios errors with no config", () => {
      const error = createAxiosError(500);
      error.config = undefined as any;
      expect(() => redactAuthorizationHeader(error)).not.toThrow();
    });
  });

  describe("logApiError", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("should log error with context prefix", () => {
      const error = new Error("Something went wrong");
      logApiError(error, "fetchData");

      expect(consoleErrorSpy).toHaveBeenCalledWith("fetchData:", "Something went wrong");
    });

    it("should not log cancellation errors (axios cancel)", () => {
      const cancelError = new axios.Cancel("Operation canceled");
      logApiError(cancelError, "fetchData");

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("should not log cancellation errors (AbortError)", () => {
      const abortError = new DOMException("Aborted", "AbortError");
      logApiError(abortError, "fetchData");

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("should not log legacy 'Request cancelled' errors", () => {
      const legacyError = new Error("Request cancelled");
      logApiError(legacyError, "fetchData");

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("should convert non-Error objects to string", () => {
      logApiError("string error", "fetchData");
      expect(consoleErrorSpy).toHaveBeenCalledWith("fetchData:", "string error");

      logApiError({ code: 123 }, "fetchData");
      expect(consoleErrorSpy).toHaveBeenCalledWith("fetchData:", "[object Object]");
    });
  });
});

// Helper function to create AxiosError with specific status
function createAxiosError(status: number): AxiosError {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: {
      status,
      statusText: getStatusText(status),
      headers: {},
      config: {} as any,
      data: null,
    },
    name: "AxiosError",
    config: {} as any,
    toJSON: () => ({}),
  }) as AxiosError;
}

function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return statusTexts[status] || "Unknown";
}
