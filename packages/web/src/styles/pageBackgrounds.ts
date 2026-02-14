/**
 * Subtle gradient backgrounds for different page types.
 * Each page has a slightly different color emphasis while maintaining cohesion.
 */

export const pageBackgrounds = {
  // Dashboard - cyan emphasis (main hub, welcoming)
  dashboard: `linear-gradient(135deg, rgba(0, 255, 255, 0.12) 0%, rgba(0, 255, 128, 0.10) 50%, rgba(255, 0, 255, 0.08) 100%)`,

  // Activities - magenta emphasis (action, energy)
  activities: `linear-gradient(
    135deg,
    rgba(255, 0, 255, 0.10) 0%,
    rgba(0, 255, 255, 0.08) 50%,
    rgba(0, 255, 128, 0.06) 100%
  )`,

  // Sport pages - balanced multi-neon
  sport: `linear-gradient(
    135deg,
    rgba(0, 255, 128, 0.10) 0%,
    rgba(0, 255, 255, 0.08) 50%,
    rgba(255, 0, 255, 0.06) 100%
  )`,

  // Origins - already styled inline, but here for reference
  origins: `linear-gradient(
    135deg,
    rgba(255, 0, 255, 0.12),
    rgba(0, 255, 255, 0.12),
    rgba(0, 255, 128, 0.12)
  )`,

  // Settings (future) - subtle cyan
  settings: `linear-gradient(
    135deg,
    rgba(0, 255, 255, 0.08) 0%,
    rgba(0, 255, 128, 0.06) 100%
  )`,
} as const;

export type PageBackgroundKey = keyof typeof pageBackgrounds;
