import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installGlobalErrorHandlers, _resetInstalledForTests } from "./global-error-handlers";

describe("installGlobalErrorHandlers", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetInstalledForTests();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("logs uncaught errors via window.error events", () => {
    installGlobalErrorHandlers();

    const error = new Error("boom");
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom",
        filename: "app.js",
        lineno: 42,
        colno: 7,
        error,
      })
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Unhandled error",
      expect.objectContaining({
        message: "boom",
        source: "app.js",
        lineno: 42,
        colno: 7,
        error,
      })
    );
  });

  it("logs unhandled promise rejections", () => {
    installGlobalErrorHandlers();

    const reason = new Error("rejected");
    // Manually construct a PromiseRejectionEvent-shaped event because
    // jsdom does not synthesize one when a real promise rejects.
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: reason });
    Object.defineProperty(event, "promise", { value: Promise.resolve() });
    window.dispatchEvent(event);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Unhandled promise rejection",
      expect.objectContaining({ reason })
    );
  });

  it("redacts Authorization header from Axios errors before logging", () => {
    installGlobalErrorHandlers();

    const axiosError = Object.assign(new Error("401"), {
      isAxiosError: true,
      name: "AxiosError",
      config: {
        headers: { Authorization: "Bearer secret-token", "X-Other": "keep" },
      },
      toJSON: () => ({}),
    });

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "axios failed",
        error: axiosError,
      })
    );

    expect(axiosError.config.headers.Authorization).toBeUndefined();
    expect(axiosError.config.headers["X-Other"]).toBe("keep");
  });

  it("is idempotent — second install does not double-register handlers", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    installGlobalErrorHandlers();
    const firstCallCount = addEventListenerSpy.mock.calls.length;
    installGlobalErrorHandlers();
    expect(addEventListenerSpy.mock.calls.length).toBe(firstCallCount);
    addEventListenerSpy.mockRestore();
  });
});
