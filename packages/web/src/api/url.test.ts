import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isInternalRequest } from "./url";

describe("isInternalRequest", () => {
  const originOnlyBase = "https://api.example.com";
  const subpathBase = "https://api.example.com/v1";

  beforeEach(() => {
    if (typeof window !== "undefined") {
      vi.stubGlobal("window", {
        location: {
          origin: "https://app.example.com",
        },
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return true for relative URLs resolved against origin-only baseURL", () => {
    expect(isInternalRequest("/users", originOnlyBase)).toBe(true);
    expect(isInternalRequest("users", originOnlyBase)).toBe(true);
    expect(isInternalRequest("", originOnlyBase)).toBe(true);
    expect(isInternalRequest(undefined, originOnlyBase)).toBe(true);
  });

  it("should return true for relative URLs resolved correctly against subpath baseURL", () => {
    // "users" relative to "https://api.example.com/v1" resolves to "https://api.example.com/v1/users"
    // IF we treat "v1" as a directory. Our implementation normalizes this.
    expect(isInternalRequest("users", subpathBase)).toBe(true);

    // "/v1/users" is explicitly under the subpath
    expect(isInternalRequest("/v1/users", subpathBase)).toBe(true);
  });

  it("should return false for relative URLs that escape the subpath baseURL", () => {
    // "/users" resolves to "https://api.example.com/users", which is OUTSIDE "/v1"
    expect(isInternalRequest("/users", subpathBase)).toBe(false);
  });

  it("should return true for absolute URLs matching the baseURL", () => {
    expect(isInternalRequest("https://api.example.com/v1", subpathBase)).toBe(true);
    expect(isInternalRequest("https://api.example.com/v1/", subpathBase)).toBe(true);
    expect(isInternalRequest("https://api.example.com/v1/users", subpathBase)).toBe(true);
  });

  it("should return false for different origins", () => {
    expect(isInternalRequest("https://google.com", subpathBase)).toBe(false);
    expect(isInternalRequest("https://api.example.com.attacker.com/v1", subpathBase)).toBe(false);
    expect(isInternalRequest("//attacker.com/v1", subpathBase)).toBe(false);
  });

  it("should prevent bypasses using casing or whitespace", () => {
    expect(isInternalRequest("HTTP://attacker.com", subpathBase)).toBe(false);
    expect(isInternalRequest("  https://attacker.com", subpathBase)).toBe(false);
    expect(isInternalRequest("https://attacker.com  ", subpathBase)).toBe(false);
  });

  it("should handle missing baseURL correctly using window.location", () => {
    // Relative URL should be true (same origin as app)
    expect(isInternalRequest("/users", undefined)).toBe(true);
    // Absolute URL to same origin should be true
    expect(isInternalRequest("https://app.example.com/users", undefined)).toBe(true);
    // Absolute URL to different origin should be false
    expect(isInternalRequest("https://api.example.com/users", undefined)).toBe(false);
  });

  it("should handle trailing slashes in baseURL correctly", () => {
    const baseURLWithSlash = "https://api.example.com/v1/";
    expect(isInternalRequest("https://api.example.com/v1", baseURLWithSlash)).toBe(true);
    expect(isInternalRequest("https://api.example.com/v1/", baseURLWithSlash)).toBe(true);
    expect(isInternalRequest("https://api.example.com/v1/users", baseURLWithSlash)).toBe(true);
  });

  describe("same-origin relative baseURL (Firebase Hosting proxy)", () => {
    // When VITE_API_GATEWAY_URL is "/api", client.ts constructs baseURL = "/api/v1".
    // These cases verify same-origin routing through the Firebase Hosting proxy.
    const relativeBase = "/api/v1";

    it("should treat relative request URLs as internal under the subpath", () => {
      expect(isInternalRequest("activities", relativeBase)).toBe(true);
      expect(isInternalRequest("activities/123/metrics", relativeBase)).toBe(true);
    });

    it("should treat absolute-path request URLs under the subpath as internal", () => {
      expect(isInternalRequest("/api/v1/activities", relativeBase)).toBe(true);
      expect(isInternalRequest("/api/v1", relativeBase)).toBe(true);
    });

    it("should treat absolute-path request URLs outside the subpath as external", () => {
      // "/users" resolves to "https://app.example.com/users" which is outside "/api/v1"
      expect(isInternalRequest("/users", relativeBase)).toBe(false);
      expect(isInternalRequest("/v1/users", relativeBase)).toBe(false);
    });

    it("should treat cross-origin absolute URLs as external", () => {
      expect(isInternalRequest("https://api.example.com/api/v1/activities", relativeBase)).toBe(
        false
      );
      expect(isInternalRequest("https://attacker.com/api/v1", relativeBase)).toBe(false);
    });

    it("should treat same-origin absolute URLs under the subpath as internal", () => {
      expect(isInternalRequest("https://app.example.com/api/v1/activities", relativeBase)).toBe(
        true
      );
    });
  });
});
