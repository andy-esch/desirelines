import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { within } from "@testing-library/react";
import { loadConfig } from "./config";
import { validateConfigOrShowError } from "./configErrorPage";
import { logger } from "./logger";
import configCheckSource from "../configCheck.ts?raw";
import indexSource from "../index.tsx?raw";

vi.mock("./config", () => ({ loadConfig: vi.fn() }));

describe("validateConfigOrShowError", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.mocked(loadConfig).mockReset();
    vi.spyOn(logger, "error").mockImplementation(() => {});
    root = document.createElement("div");
    root.innerHTML = "<p>app shell</p>";
    document.body.append(root);
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it("leaves the page alone when the configuration is valid", () => {
    validateConfigOrShowError(root);

    expect(root.innerHTML).toBe("<p>app shell</p>");
  });

  it("replaces the page with the validation message and rethrows", () => {
    const error = new Error(
      "VITE_FIREBASE_API_KEY (firebase.apiKey): Firebase API Key is required"
    );
    vi.mocked(loadConfig).mockImplementation(() => {
      throw error;
    });

    expect(() => validateConfigOrShowError(root)).toThrow(error);
    const page = within(root);
    expect(page.getByRole("heading", { name: "Configuration Error" })).toBeInTheDocument();
    expect(page.getByText(error.message)).toBeInTheDocument();
    expect(page.queryByText("app shell")).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledWith("Failed to load application configuration:", error);
  });
});

describe("startup order", () => {
  // The app's imports reach lib/firebase.ts, which reads the configuration as it
  // loads, so the check only shows its page if it runs before them.
  it("checks the configuration before index.tsx imports anything else", () => {
    const imports = indexSource.match(/^import .*$/gm) ?? [];
    expect(imports[0]).toBe('import "./configCheck";');
    expect(configCheckSource).toMatch(/^validateConfigOrShowError\(\);$/m);
  });
});
