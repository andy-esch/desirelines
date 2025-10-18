/**
 * Window interface extensions
 *
 * Extends the global Window interface to include custom properties
 * used by the application.
 */

export {};

declare global {
  interface Window {
    /**
     * Runtime environment configuration
     * Loaded from /config.js in production
     */
    ENV?: {
      REACT_APP_API_URL?: string;
    };
  }
}
