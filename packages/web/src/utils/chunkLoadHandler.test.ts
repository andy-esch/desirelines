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

    // The function calls reload() and returns (halts execution) rather than
    // throwing, so the error boundary never renders during the reload attempt.
    handleChunkLoadError(error);
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("should reload the page for 'is not a valid JavaScript MIME type' errors", () => {
    const error = new Error(
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec. — is not a valid JavaScript MIME type'
    );

    handleChunkLoadError(error);
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("should reload the page for 'Importing a module script failed' errors", () => {
    const error = new Error("Importing a module script failed");

    handleChunkLoadError(error);
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("should preserve the sessionStorage guard key after triggering a reload", () => {
    const error = new Error("Failed to fetch dynamically imported module: /assets/Page-abc123.js");

    handleChunkLoadError(error);
    // The guard must remain set so the *next* page load knows a reload was
    // already attempted — this is what prevents infinite reload loops.
    expect(sessionStorage.getItem("chunk-load-reload")).toBe("1");
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

  it("should not clear the guard for non-chunk errors", () => {
    // Simulate: a previous chunk reload set the guard, then a different error
    // occurs on the same page load. The guard should remain untouched.
    sessionStorage.setItem("chunk-load-reload", "1");
    const error = new Error("Some random component error");

    expect(() => handleChunkLoadError(error)).toThrow(error);
    // Non-chunk errors should not touch the guard at all
    expect(sessionStorage.getItem("chunk-load-reload")).toBe("1");
  });

  it("should re-throw non-Error values without reloading", () => {
    expect(() => handleChunkLoadError("string error")).toThrow();
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
