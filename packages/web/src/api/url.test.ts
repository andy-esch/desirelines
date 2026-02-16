import { describe, it, expect } from "vitest";
import { isInternalRequest } from "./url";

describe("isInternalRequest", () => {
  const baseURL = "https://api.example.com/v1";

  it("should return true for relative URLs", () => {
    expect(isInternalRequest("/users", baseURL)).toBe(true);
    expect(isInternalRequest("users", baseURL)).toBe(true);
    expect(isInternalRequest("", baseURL)).toBe(true);
    expect(isInternalRequest(undefined, baseURL)).toBe(true);
  });

  it("should return true for absolute URLs matching the baseURL", () => {
    expect(isInternalRequest("https://api.example.com/v1", baseURL)).toBe(true);
    expect(isInternalRequest("https://api.example.com/v1/", baseURL)).toBe(true);
    expect(isInternalRequest("https://api.example.com/v1/users", baseURL)).toBe(true);
  });

  it("should return false for different origins", () => {
    expect(isInternalRequest("https://google.com", baseURL)).toBe(false);
    expect(isInternalRequest("https://api.example.com.attacker.com/v1", baseURL)).toBe(false);
    expect(isInternalRequest("//attacker.com/v1", baseURL)).toBe(false);
  });

  it("should return false for domain squatting/prefix matches without boundary", () => {
    // baseURL is https://api.example.com/v1
    expect(isInternalRequest("https://api.example.com/v1-extra", baseURL)).toBe(false);
    expect(isInternalRequest("https://api.example.com/v10", baseURL)).toBe(false);
  });

  it("should return false if baseURL is missing and URL is absolute", () => {
    expect(isInternalRequest("https://api.example.com/v1", undefined)).toBe(false);
  });

  it("should return true for relative URLs even if baseURL is missing", () => {
    expect(isInternalRequest("/users", undefined)).toBe(true);
  });

  it("should handle trailing slashes in baseURL correctly", () => {
    const baseURLWithSlash = "https://api.example.com/v1/";
    expect(isInternalRequest("https://api.example.com/v1", baseURLWithSlash)).toBe(true);
    expect(isInternalRequest("https://api.example.com/v1/", baseURLWithSlash)).toBe(true);
    expect(isInternalRequest("https://api.example.com/v1/users", baseURLWithSlash)).toBe(true);
  });
});
