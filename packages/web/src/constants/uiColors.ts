/**
 * UI Color Scheme
 *
 * Single source of truth for UI colors in TypeScript.
 * These values must match the CSS variables in dashboard.css :root
 *
 * Philosophy:
 * - NEON colors (full brightness) stay on charts (see chartColors.ts)
 * - UI uses toned-down accents (90% brightness cyan, magenta)
 * - Slate tones for neutral elements (matches header background)
 */

/**
 * Slate palette - neutral grays derived from header background
 */
export const SLATE = {
  DARK: "#2d3748",
  DEFAULT: "#4a5568",
  LIGHT: "#718096",
  LIGHTER: "#a0aec0",
} as const;

/**
 * Accent colors - toned-down NEON for UI interactions
 */
export const ACCENT = {
  // Cyan - primary accent (buttons, links, focus states)
  CYAN: "#00d4ff",
  CYAN_HOVER: "#00b8e6",
  CYAN_GLOW: "rgba(0, 212, 255, 0.15)",
  CYAN_TEXT: "#1a202c", // Dark text on cyan backgrounds

  // Magenta - secondary accent (link underlines, highlights)
  MAGENTA: "#ff00ff",
  MAGENTA_GLOW: "rgba(255, 0, 255, 0.15)",
} as const;

/**
 * Semantic color assignments
 */
export const UI_COLORS = {
  // Backgrounds
  headerBg: SLATE.DARK,
  cardBg: SLATE.DEFAULT,

  // Text
  textMuted: SLATE.LIGHT,
  textSubtle: SLATE.LIGHTER,

  // Links
  link: ACCENT.CYAN,
  linkHoverUnderline: ACCENT.MAGENTA,

  // Interactive
  focusRing: ACCENT.CYAN_GLOW,
  buttonPrimary: ACCENT.CYAN,
  buttonPrimaryText: ACCENT.CYAN_TEXT,
} as const;

/**
 * CSS variable names (for use with var())
 * Use these when you need to reference CSS variables in inline styles
 */
export const CSS_VARS = {
  slateDark: "var(--slate-dark)",
  slate: "var(--slate)",
  slateLight: "var(--slate-light)",
  slateLighter: "var(--slate-lighter)",
  accentCyan: "var(--accent-cyan)",
  accentCyanHover: "var(--accent-cyan-hover)",
  accentCyanGlow: "var(--accent-cyan-glow)",
  accentMagenta: "var(--accent-magenta)",
  accentMagentaGlow: "var(--accent-magenta-glow)",
} as const;
