import type { ThemeStructure } from "./registry";

/**
 * The pre-retro structure Legacy light rendered with: card headers, stat cards, badges, the
 * percent bar and race track, the spinner and a washed danger zone. No theme in the list
 * uses these choices since Legacy light was deleted, but the components still carry them,
 * so the tests and the dev gallery's structure preview draw them from here until they are
 * removed.
 */
export const LEGACY_STRUCTURE: ThemeStructure = {
  showPageKicker: false,
  heroDecoration: "none",
  sectionLabelPlacement: "card-header",
  statRowStyle: "cards",
  sliderTrack: "continuous",
  rowHoverCursor: false,
  pagerStyle: "arrows",
  sportMarkStyle: "badge",
  statusSymbolStyle: "badge",
  goalTrackStyle: "bar-with-percent",
  meterPartialCurrent: false,
  loaderStyle: "spinner",
  dangerZoneFill: "wash",
  chartMarkerShape: "circle",
  chartLegend: true,
  mapDrawerSections: "flat",
  dateFormat: "short",
};
