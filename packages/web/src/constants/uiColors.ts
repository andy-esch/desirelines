/**
 * UI Color Scheme Documentation
 *
 * This file documents the UI color palette and button hierarchy.
 * The actual implementation is in CSS variables (see dashboard.css :root).
 *
 * Philosophy:
 * - NEON colors stay mostly on charts (see chartColors.ts)
 * - UI elements use calm/neutral slate tones that match the header
 * - Accent color (cyan) appears on hover and primary CTAs only
 * - This creates visual hierarchy without overdoing the NEON theme
 *
 * CSS Variables (defined in dashboard.css):
 *   --slate-dark:        #2d3748  (header background, darkest surfaces)
 *   --slate:             #4a5568  (button borders, card backgrounds)
 *   --slate-light:       #718096  (muted text, disabled states)
 *   --slate-lighter:     #a0aec0  (hover text, subtle highlights)
 *   --accent-cyan:       #00d4ff  (primary accent, 90% brightness)
 *   --accent-cyan-hover: #00b8e6  (darker cyan for hover states)
 *   --accent-cyan-glow:  rgba(0, 212, 255, 0.15)  (hover backgrounds)
 *   --accent-cyan-text:  #1a202c  (text on cyan backgrounds)
 *
 * Button Classes:
 *   .btn-accent         - Primary CTAs (solid cyan) - use sparingly
 *   .btn-outline-slate  - Secondary actions (slate outline, cyan hover)
 *   .btn-ghost-slate    - Tertiary/minor actions (subtle)
 *
 * Other UI Classes:
 *   .alert-demo         - Demo mode banner (transparent cyan)
 */

// Re-export for programmatic use if needed
export const UI_COLORS = {
  SLATE_DARK: "#2d3748",
  SLATE: "#4a5568",
  SLATE_LIGHT: "#718096",
  ACCENT_CYAN: "#00d4ff",
} as const;
