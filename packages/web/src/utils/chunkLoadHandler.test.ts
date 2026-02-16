import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleChunkLoadError } from "./chunkLoadHandler";

describe("handleChunkLoadError", () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("window", {
      ...window,
      location: { ...window.location, reload: reloadMock },
    });
  });

  afterEach(() => {
    reloadMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("should reload the page for 'Failed to fetch dynamically imported module' errors", () => {
    const error = new Error("Failed to fetch dynamically imported module: /assets/Page-abc123.js");

    // reload() doesn't actually stop execution in tests, so the function
    // will continue past it and throw — but reload should still be called.
    expect(() => handleChunkLoadError(error)).toThrow();
    expect(reloadMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("chunk-load-reload")).toBeNull(); // cleared after throw
  });

  it("should reload the page for 'is not a valid JavaScript MIME type' errors", () => {
    const error = new Error(
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec. — is not a valid JavaScript MIME type'
    );

    expect(() => handleChunkLoadError(error)).toThrow();
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("should reload the page for 'Importing a module script failed' errors", () => {
    const error = new Error("Importing a module script failed");

    expect(() => handleChunkLoadError(error)).toThrow();
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("should not reload if a reload was already attempted (sessionStorage guard)", () => {
    sessionStorage.setItem("chunk-load-reload", "1");
    const error = new Error("Failed to fetch dynamically imported module: /assets/Page-abc123.js");

    expect(() => handleChunkLoadError(error)).toThrow(error);
    expect(reloadMock).not.toHaveBeenCalled();
    // Guard should be cleared so future deploys can trigger a reload
    expect(sessionStorage.getItem("chunk-load-reload")).toBeNull();
  });

  it("should re-throw non-chunk errors without reloading", () => {
    const error = new Error("Some random component error");

    expect(() => handleChunkLoadError(error)).toThrow(error);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("should re-throw non-Error values without reloading", () => {
    expect(() => handleChunkLoadError("string error")).toThrow();
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
