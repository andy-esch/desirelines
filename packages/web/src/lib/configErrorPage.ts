import { loadConfig } from "./config";
import { logger } from "./logger";

/**
 * Validates the configuration before the app starts. If it is invalid, replaces
 * the page with an error listing what is wrong, then rethrows so nothing else
 * starts on a bad configuration.
 */
export function validateConfigOrShowError(
  root: HTMLElement | null = document.getElementById("root")
): void {
  try {
    loadConfig();
  } catch (error) {
    logger.error("Failed to load application configuration:", error);
    root?.replaceChildren(configErrorPage(error));
    throw error;
  }
}

// Plain DOM rather than React: React may not have loaded yet.
function configErrorPage(error: unknown): HTMLElement {
  const container = document.createElement("div");
  container.style.cssText =
    "padding: 40px; font-family: monospace; max-width: 800px; margin: 0 auto;";

  const heading = document.createElement("h1");
  heading.style.color = "#d32f2f";
  heading.textContent = "Configuration Error";

  const description = document.createElement("p");
  description.style.cssText = "font-size: 16px; line-height: 1.6;";
  description.textContent = "The application failed to start due to invalid configuration.";

  const pre = document.createElement("pre");
  pre.style.cssText =
    "background: #f5f5f5; padding: 20px; border-radius: 4px; overflow-x: auto; font-size: 14px;";
  pre.textContent = error instanceof Error ? error.message : String(error);

  const hint = document.createElement("p");
  hint.style.cssText = "margin-top: 20px; color: #666;";
  hint.textContent =
    "This usually means environment variables are missing or invalid. Check the console for more details.";

  container.append(heading, description, pre, hint);
  return container;
}
