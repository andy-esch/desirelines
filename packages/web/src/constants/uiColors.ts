/**
 * UI Color Scheme - Reference Documentation
 *
 * PURPOSE: This file serves as TypeScript documentation for the UI color system.
 * It mirrors the CSS custom properties defined in `src/css/variables.css`.
 *
 * WHY THIS EXISTS:
 * - Provides IntelliSense/autocomplete for color values in TypeScript
 * - Documents the color system design decisions
 * - Can be imported if programmatic color access is needed (e.g., for charts, dynamic styles)
 *
 * IMPORTANT: The source of truth for runtime styles is `variables.css`.
 * If you change colors, update BOTH files to keep them in sync.
 *
 * COLOR PHILOSOPHY:
 * - NEON colors (full brightness) are reserved for charts (see chartColors.ts)
 * - UI uses toned-down accents (cyan for interactive, magenta for hover accents)
 * - Slate tones for neutral elements (matches header background)
 *
 * HIERARCHY:
 * - Primary: Cyan (`btn-accent`) - Main CTAs like "Try Demo", "Sign In"
 * - Secondary: Slate outline (`btn-outline-slate`) - Important actions like "Add Goal"
 * - Tertiary: Ghost slate (`btn-ghost-slate`) - Minor actions like "Load More"
 *
 * @see src/css/variables.css - CSS variables (source of truth)
 * @see src/css/dashboard.css - Component styles
 * @see src/constants/chartColors.ts - Chart-specific NEON colors
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

/**
 * Neon colors - full brightness versions for skeleton loaders and animations.
 * These match the NeonSpinner and chart palettes.
 */
export const NEON = {
  CYAN: "rgb(0, 255, 255)",
  MAGENTA: "rgb(255, 0, 255)",
  PURPLE: "rgb(180, 0, 255)",
  GREEN: "rgb(0, 255, 128)",
} as const;

/**
 * Skeleton loader color themes using subtle neon tints.
 * Each theme has a base color (resting state) and highlight color (animation pulse).
 */
export const SKELETON_THEMES = [
  { baseColor: "rgba(0, 255, 255, 0.12)", highlightColor: "rgba(0, 255, 255, 0.22)" }, // Cyan
  { baseColor: "rgba(255, 0, 255, 0.12)", highlightColor: "rgba(255, 0, 255, 0.22)" }, // Magenta
  { baseColor: "rgba(180, 0, 255, 0.12)", highlightColor: "rgba(180, 0, 255, 0.22)" }, // Purple
] as const;

/**
 * Dual-color skeleton themes — base and highlight are different neon colors
 * for a richer two-tone pulse effect. Used by dashboard cards.
 */
export const SKELETON_DUAL_THEMES = [
  { baseColor: "rgba(0, 255, 255, 0.12)", highlightColor: "rgba(255, 0, 255, 0.22)" }, // Cyan → Magenta
  { baseColor: "rgba(0, 255, 128, 0.12)", highlightColor: "rgba(255, 200, 0, 0.22)" }, // Green → Yellow
  { baseColor: "rgba(180, 0, 255, 0.12)", highlightColor: "rgba(0, 255, 255, 0.22)" }, // Purple → Cyan
] as const;
