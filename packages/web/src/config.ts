/**
 * Application configuration (backward compatibility layer)
 *
 * This file maintains exports for existing code that imports from src/config.ts
 * The actual configuration is now managed by src/lib/config.ts with Zod validation.
 *
 * @deprecated Import from src/lib/config.ts for type-safe validated config
 */

import { getConfig } from "./lib/config";

// Load validated configuration
const appConfig = getConfig();

// API Gateway URL
export const API_BASE_URL = appConfig.apiGatewayUrl || "";

// Note: Configuration logging moved to src/lib/config.ts
