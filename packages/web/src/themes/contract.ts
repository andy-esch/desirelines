/**
 * The theme contract: every token a theme file sets, with the kind of value it holds, and
 * the fixed tokens `tailwind.css` sets once for every theme.
 *
 * A theme is a `css/themes/<id>.css` file of values (see registry.ts). The contract is
 * what makes a new theme's gaps a test failure rather than a silent inheritance:
 * `themeContract.test.ts` checks that each file sets exactly these slots, each with a value
 * of its kind, and that the style guide's slot table lists them; `themeContrast.test.ts`
 * checks the pairs below in every theme; `themeTokenUse.test.ts` checks that nothing reads a
 * token the contract, `tailwind.css` or a component doesn't define.
 *
 * Groups are the rows of the style guide's "Theme slots" table, plus `Colors` for the role
 * colors "The color system" describes. A color a single component family reads (a pressed
 * toggle, a meter) sits with that family's slots.
 *
 * Kinds, as a theme file writes them (a `var()` of another token counts as that token's
 * value):
 * - `color`: hex, `rgb()`/`rgba()`, `color-mix()`, `transparent` or `currentColor`
 * - `length`: a number with a unit (`0px`, not `0`, so `calc()` can add to it); `lengths`
 *   is one to four of them, as padding takes
 * - `percentage`, `number`, `weight` (100 to 900, `normal` or `bold`), `tracking` (a length
 *   or `normal`), `case` (a `text-transform` keyword)
 * - `font`: a font-family stack
 * - `shadow`: `box-shadow` layers or `none`; `text-shadow`: text-shadow layers or `none`;
 *   `inset-glow`: one shadow layer without `inset`, which the reader adds (`0 0 #0000` for none)
 * - `border`: `none` or width, style and color
 * - `image`: `none` or a gradient; `filter`: `none` or filter functions
 * - `dash`: a `stroke-dasharray` of numbers
 *
 * A slot marked `initial` may be set to `initial` in a theme that keeps the default: the slot
 * is then unset, and its reader's `var()` fallback resolves on the element.
 */

export type SlotKind =
  | "color"
  | "length"
  | "lengths"
  | "percentage"
  | "number"
  | "weight"
  | "tracking"
  | "case"
  | "font"
  | "shadow"
  | "text-shadow"
  | "inset-glow"
  | "border"
  | "image"
  | "filter"
  | "dash";

export interface SlotSpec {
  readonly kind: SlotKind;
  /** A theme may set `initial`, leaving its reader's fallback to apply. */
  readonly initial?: true;
  /** Keywords the slot takes beyond its kind's own. */
  readonly keywords?: readonly string[];
}

type GroupSlots = Readonly<Record<`--${string}`, SlotKind | SlotSpec>>;

export const THEME_CONTRACT = {
  Colors: {
    "--color-bg-body": "color",
    "--color-muted-text": "color",
    "--color-subtle-text": "color",
    "--color-surface-raised": "color",
    "--color-control-border": "color",
    "--color-divider": "color",
    "--color-panel-border": "color",
    "--color-panel-border-hover": "color",
    "--color-fill-muted": "color",
    "--color-intensity-0": "color",
    "--color-on-accent": "color",
    "--color-accent-cyan": "color",
    "--color-accent-cyan-glow": "color",
    "--color-accent-cyan-text": "color",
    "--color-neon-accent": "color",
    "--color-neon-accent-border": "color",
    "--color-neon-accent-glow": "color",
    "--color-map-chrome-accent": "color",
    "--color-accent-magenta": "color",
    "--color-body-text": "color",
    "--color-chip-hairline": "color",
    "--color-chart-grid": "color",
    "--color-chart-mark-outline": "color",
    "--color-chart-axis": "color",
    "--color-chart-tick": "color",
    "--color-chart-actual-line": "color",
    "--color-chart-tooltip-bg": "color",
    "--color-chart-tooltip-border": "color",
    "--color-chart-tooltip-text": "color",
    "--color-chart-tooltip-muted": "color",
    "--color-chart-tooltip-label": "color",
    "--color-chart-tooltip-divider": "color",
    "--color-goal-1": "color",
    "--color-goal-2": "color",
    "--color-goal-3": "color",
    "--color-goal-4": "color",
    "--color-goal-5": "color",
    "--color-chart-average-line": "color",
    "--color-chart-neutral": "color",
    "--color-danger-zone": "color",
    "--color-danger-zone-label": "color",
    "--color-success": "color",
    "--color-danger": "color",
    "--color-warning": "color",
    "--color-header-bg": "color",
    "--color-header-border": "color",
    "--color-header-text": "color",
    "--color-header-text-muted": "color",
    "--color-header-accent": "color",
    "--color-surface-hover": "color",
    "--color-surface-border": "color",
    "--color-surface-overlay": "color",
    "--color-surface-shadow": "color",
  },
  Type: {
    "--font-body": "font",
    "--font-display": "font",
    "--font-chart": "font",
    "--display-weight": "weight",
  },
  "Page titles": {
    "--page-title-size": "length",
    "--page-title-color": "color",
    "--page-title-shadow": "text-shadow",
    "--page-title-glow-size": "length",
    "--page-title-offset-shadow": "text-shadow",
    "--page-title-case": "case",
    "--page-title-leading": "number",
    "--display-text-gradient": "image",
    "--display-text-fill": "color",
  },
  Labels: {
    "--kicker-size": "length",
    "--kicker-tracking": "tracking",
    "--kicker-color": "color",
    "--label-size": "length",
    "--label-tracking": "tracking",
    "--label-weight": "weight",
    "--label-color": "color",
    "--label-case": "case",
    "--data-label-case": "case",
  },
  Numbers: {
    "--table-text-size": "length",
    "--stat-value-size": "length",
    "--stat-value-size-wide": "length",
    "--stat-value-shadow": "text-shadow",
    "--stat-label-size": "length",
    "--stat-label-tracking": "tracking",
    "--stat-label-case": "case",
    "--stat-sub-size": "length",
    "--stat-sub-color": "color",
  },
  Wordmark: {
    "--wordmark-font": "font",
    "--wordmark-size": "length",
    "--wordmark-weight": "weight",
    "--wordmark-tracking": "tracking",
    "--wordmark-case": "case",
    "--wordmark-color": "color",
    "--wordmark-color-2": "color",
    "--wordmark-slash-color": "color",
    "--wordmark-slash-size": "length",
    "--wordmark-slash-weight": "weight",
    "--wordmark-shadow": "text-shadow",
  },
  Header: {
    "--header-height": { kind: "length", keywords: ["auto"] },
    "--header-border": "border",
    "--header-accent-line": "image",
    "--header-shadow-scrolled": "shadow",
    "--nav-size": "length",
    "--nav-tracking": "tracking",
    "--nav-case": "case",
    "--nav-active-bg": "color",
    "--nav-active-radius": "length",
    "--nav-active-underline": "border",
    "--nav-active-shadow": "text-shadow",
    "--nav-color": "color",
    "--nav-active-color": "color",
    "--nav-active-hover-bg": "color",
    "--avatar-radius": "length",
    "--avatar-border": "border",
    "--avatar-glow": "shadow",
    "--demo-rule": "border",
    "--demo-bg": "color",
    "--demo-border": "border",
    "--header-date-color": "color",
  },
  Backgrounds: {
    "--page-wash-strength": "number",
    "--sport-wash-strength": "number",
    "--hero-padding": "lengths",
    "--hero-ink": "color",
    "--hero-title-size": "length",
    "--hero-title-color": "color",
    "--hero-title-shadow": "text-shadow",
    "--hero-number-size": "length",
    "--hero-number-glow": "length",
    "--glass-blur": "length",
    "--glass-blur-sm": "length",
    "--progress-shine": "image",
  },
  Panels: {
    "--radius": "length",
    "--panel-bg": "color",
    "--panel-border-width": "length",
    "--panel-radius": "length",
    "--panel-shadow": "shadow",
    "--panel-shadow-emphasis": "shadow",
    "--panel-header-padding": "lengths",
    "--panel-body-padding": "lengths",
    "--panel-accent-1": "color",
    "--panel-accent-2": "color",
    "--panel-accent-3": "color",
    "--panel-accent-1-ink": "color",
    "--panel-accent-2-ink": "color",
    "--panel-accent-3-ink": "color",
  },
  Controls: {
    "--control-height": "length",
    "--control-radius": "length",
    "--control-font-size": "length",
    "--control-case": "case",
    "--control-focus-ring": { kind: "shadow", initial: true },
    "--toggle-gap": "length",
    "--toggle-frame-border-width": "length",
    "--toggle-frame-padding": "lengths",
    "--toggle-frame-radius": "length",
    "--toggle-item-border-width": "length",
    "--toggle-item-radius": "length",
    "--toggle-font-size": "length",
    "--toggle-tracking": "tracking",
    "--toggle-case": "case",
    "--toggle-frame-border-color": "color",
    "--toggle-item-color": "color",
    "--color-toggle-pressed": { kind: "color", initial: true },
    "--color-toggle-pressed-border": { kind: "color", initial: true },
    "--color-toggle-pressed-text": { kind: "color", initial: true },
    "--toggle-pressed-glow": "inset-glow",
    "--toggle-pressed-text-glow": "text-shadow",
    "--button-radius": "length",
    "--button-case": "case",
    "--button-tracking": "tracking",
    "--stepper-gap": "length",
  },
  "Sliders and chips": {
    "--slider-track-height": "length",
    "--slider-track-radius": "length",
    "--slider-handle-size": "length",
    "--slider-handle-radius": "length",
    "--slider-handle-border-width": "length",
    "--slider-track-bg": "color",
    "--slider-fill-glow": "shadow",
    "--color-slider-fill": { kind: "color", initial: true },
    "--chip-radius": "length",
    "--chip-border-strength": "percentage",
    "--chip-hover-strength": "percentage",
    "--chip-dot-radius": "length",
  },
  Tables: {
    "--th-size": "length",
    "--th-weight": "weight",
    "--th-color": "color",
    "--th-tracking": "tracking",
    "--th-case": "case",
    "--th-rule": "border",
    "--row-rule": "border",
    "--row-padding": "lengths",
    "--row-hover-bg": "color",
    "--missing-value-color": { kind: "color", initial: true },
    "--sport-mark-radius": "length",
  },
  "Goals and meters": {
    "--track-height": "length",
    "--track-bg": "color",
    "--track-border": "border",
    "--track-fill-height": "length",
    "--track-fill-glow": "length",
    "--track-radius": "length",
    "--pace-tick-width": "length",
    "--pace-tick-height": "length",
    "--meter-segment-width": "length",
    "--meter-segment-height": "length",
    "--meter-gap": "length",
    "--meter-radius": "length",
    "--cell-empty-border": "border",
    "--cell-radius": "length",
    "--color-meter-done": "color",
    "--color-meter-current": "color",
    "--color-meter-todo": "color",
    "--meter-done-glow": "shadow",
    "--meter-current-glow": "shadow",
    "--color-pace-tick": "color",
  },
  Status: {
    "--color-status-good": "color",
    "--color-status-warn": "color",
    "--color-status-bad": "color",
    "--status-size": "length",
    "--status-tracking": "tracking",
    "--status-case": "case",
  },
  Charts: {
    "--chart-baseline": "color",
    "--chart-tick-size": "length",
    "--chart-actual-glow": "filter",
    "--chart-average-dash": "dash",
    "--chart-bar-radius": "length",
    "--chart-bar-gap": "length",
    "--chart-hover-column": "color",
    "--tooltip-radius": "length",
  },
  "Map chrome": {
    "--map-chrome-bg": "color",
    "--map-chrome-edge": "border",
    "--map-chrome-shadow": "shadow",
    "--popup-radius": "length",
    "--popup-border": "border",
    "--popup-shadow": "shadow",
  },
} as const satisfies Readonly<Record<string, GroupSlots>>;

type Contract = typeof THEME_CONTRACT;
type KindOf<S> = S extends SlotKind ? S : S extends { readonly kind: infer K } ? K : never;

export type ThemeSlotGroup = keyof Contract;

/** A token every theme file sets. */
export type ThemeSlot = { [G in ThemeSlotGroup]: keyof Contract[G] }[ThemeSlotGroup];

/** A theme slot that holds a color. */
export type ThemeColorSlot = {
  [G in ThemeSlotGroup]: {
    [N in keyof Contract[G]]: KindOf<Contract[G][N]> extends "color" ? N : never;
  }[keyof Contract[G]];
}[ThemeSlotGroup];

/**
 * Colors `tailwind.css` sets once, the same in every theme: the brand and neon primitives,
 * the heatmap's upper steps, the map's point outline, the header's brightest ink and the
 * scrim. A theme file never sets them.
 */
export const FIXED_COLORS = [
  "--color-brand-cyan",
  "--color-neon-cyan",
  "--color-neon-magenta",
  "--color-neon-purple",
  "--color-neon-green",
  "--color-neon-yellow",
  "--color-neon-orange",
  "--color-neon-lime",
  "--color-neon-yellow-pure",
  "--color-intensity-1",
  "--color-intensity-2",
  "--color-intensity-3",
  "--color-intensity-4",
  "--color-map-point-outline",
  "--color-header-ink",
  "--color-scrim",
  "--color-on-scrim",
] as const;

export type FixedColor = (typeof FIXED_COLORS)[number];

/** A color token a component may name: a theme's color slot or a fixed color. */
export type ColorToken = ThemeColorSlot | FixedColor;

export interface ThemeSlotSpec extends SlotSpec {
  readonly group: ThemeSlotGroup;
}

/** The contract flattened, in declaration order. */
export const THEME_SLOTS: ReadonlyMap<ThemeSlot, ThemeSlotSpec> = new Map(
  Object.entries(THEME_CONTRACT).flatMap(([group, slots]: [string, GroupSlots]) =>
    Object.entries(slots).map(([name, spec]): [ThemeSlot, ThemeSlotSpec] => [
      name as ThemeSlot,
      { group: group as ThemeSlotGroup, ...(typeof spec === "string" ? { kind: spec } : spec) },
    ])
  )
);

/** The contract's spec for a token name, or undefined when it isn't a theme slot. */
export function slotSpec(name: string): ThemeSlotSpec | undefined {
  return THEME_SLOTS.get(name as ThemeSlot);
}

/**
 * Text that must stay legible on what it sits on, in every theme.
 *
 * `text` and `on` each name a slot, then what it falls back to where a theme sets it to
 * `initial` or `currentColor`. A translucent or transparent surface is measured over `over`
 * (the page ground unless given). `min` is WCAG's 4.5:1 for text, or 3:1 for large display
 * text.
 */
export interface ContrastPair {
  readonly text: readonly [ThemeColorSlot, ...ThemeColorSlot[]];
  readonly on: readonly [ThemeColorSlot, ...ThemeColorSlot[]];
  readonly over?: ThemeColorSlot;
  readonly min: 4.5 | 3;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // Copy on the page, raised surfaces and panels.
  { text: ["--color-body-text"], on: ["--color-bg-body"], min: 4.5 },
  { text: ["--color-body-text"], on: ["--color-surface-raised"], min: 4.5 },
  { text: ["--color-body-text"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--color-muted-text"], on: ["--color-bg-body"], min: 4.5 },
  { text: ["--color-muted-text"], on: ["--color-surface-raised"], min: 4.5 },
  { text: ["--color-muted-text"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--color-subtle-text"], on: ["--color-bg-body"], min: 4.5 },
  { text: ["--page-title-color"], on: ["--color-bg-body"], min: 3 },
  { text: ["--kicker-color"], on: ["--color-bg-body"], min: 4.5 },
  { text: ["--label-color"], on: ["--color-bg-body"], min: 4.5 },
  { text: ["--panel-accent-1-ink"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--panel-accent-2-ink"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--panel-accent-3-ink"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--stat-sub-color"], on: ["--panel-bg"], min: 4.5 },
  // Accent and danger text: links and interactive labels, their hover, and error copy.
  { text: ["--color-accent-cyan"], on: ["--color-bg-body"], min: 4.5 },
  { text: ["--color-accent-cyan"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--color-accent-magenta"], on: ["--color-bg-body"], min: 4.5 },
  { text: ["--color-danger"], on: ["--panel-bg"], min: 4.5 },
  // Controls: a primary button's label, toggle items in their frame, and the pressed item,
  // whose transparent fill (Arcade's) shows the frame.
  { text: ["--color-accent-cyan-text"], on: ["--color-accent-cyan"], min: 4.5 },
  { text: ["--toggle-item-color"], on: ["--color-surface-raised"], min: 4.5 },
  {
    text: ["--color-toggle-pressed-text", "--color-accent-cyan-text"],
    on: ["--color-toggle-pressed", "--color-accent-cyan"],
    over: "--color-surface-raised",
    min: 4.5,
  },
  // Header.
  { text: ["--color-header-text"], on: ["--color-header-bg"], min: 4.5 },
  { text: ["--color-header-text-muted"], on: ["--color-header-bg"], min: 4.5 },
  { text: ["--nav-color"], on: ["--color-header-bg"], min: 4.5 },
  { text: ["--nav-active-color"], on: ["--color-header-bg"], min: 4.5 },
  { text: ["--header-date-color"], on: ["--color-header-bg"], min: 4.5 },
  // Tables, goals and charts, which sit in panels.
  { text: ["--th-color", "--color-body-text"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--missing-value-color", "--color-body-text"], on: ["--panel-bg"], min: 4.5 },
  // A missing value also shows on the page (the sidebar summary) and in chart tooltips.
  { text: ["--missing-value-color", "--color-body-text"], on: ["--color-bg-body"], min: 4.5 },
  {
    text: ["--missing-value-color", "--color-chart-tooltip-muted"],
    on: ["--color-chart-tooltip-bg"],
    min: 4.5,
  },
  { text: ["--color-status-good"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--color-status-warn"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--color-status-bad"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--color-chart-tick"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--color-danger-zone-label"], on: ["--panel-bg"], min: 4.5 },
  { text: ["--color-chart-tooltip-text"], on: ["--color-chart-tooltip-bg"], min: 4.5 },
  { text: ["--color-chart-tooltip-muted"], on: ["--color-chart-tooltip-bg"], min: 4.5 },
  { text: ["--color-chart-tooltip-label"], on: ["--color-chart-tooltip-bg"], min: 4.5 },
];

/**
 * Where a color is measured from: a color slot; a shadow or border slot, measured by the
 * color of its first layer; or a color slot at partial strength.
 */
export type ColorSource = ThemeSlot | { readonly slot: ThemeColorSlot; readonly alpha: number };

/**
 * Non-text UI that must stand out from what it sits on, in every theme: WCAG 1.4.11's 3:1
 * for a focus indicator, a control's state, and a part that identifies a control or a
 * graphic. `mark` lists where the color comes from, then what it falls back to; `on` and
 * `over` work as in {@link ContrastPair}.
 */
export interface MarkPair {
  readonly mark: readonly [ColorSource, ...ColorSource[]];
  readonly on: readonly [ThemeColorSlot, ...ThemeColorSlot[]];
  readonly over?: ThemeColorSlot;
}

/** WCAG 1.4.11's floor for non-text contrast. */
export const MARK_MIN = 3;

/**
 * Keyboard focus. A theme that leaves the ring `initial` gets the `control-focus-ring`
 * utility's own fallback in `tailwind.css`: the accent at 40%.
 */
const FOCUS_RING = ["--control-focus-ring", { slot: "--color-accent-cyan", alpha: 0.4 }] as const;

export const MARK_PAIRS: readonly MarkPair[] = [
  // The focus ring, on each surface a control sits on.
  { mark: FOCUS_RING, on: ["--color-bg-body"] },
  { mark: FOCUS_RING, on: ["--color-surface-raised"] },
  { mark: FOCUS_RING, on: ["--panel-bg"] },
  { mark: FOCUS_RING, on: ["--color-header-bg"] },
  { mark: FOCUS_RING, on: ["--map-chrome-bg"] },
  // An input's or select's border, which is what outlines it: its fill is close to the
  // page's.
  { mark: ["--color-control-border"], on: ["--color-bg-body"] },
  { mark: ["--color-control-border"], on: ["--color-surface-raised"] },
  // A pressed toggle's border, or its fill where it has no border of its own, in its frame.
  {
    mark: ["--color-toggle-pressed-border", "--color-toggle-pressed", "--color-accent-cyan"],
    on: ["--color-surface-raised"],
  },
  // A slider's filled track and handle, in the routes-map drawer that holds the sliders.
  { mark: ["--color-slider-fill", "--color-accent-cyan"], on: ["--map-chrome-bg"] },
  // A year meter's done segments.
  { mark: ["--color-meter-done"], on: ["--panel-bg"] },
];

/**
 * Boundaries and fills the mark pairs leave out, each with the reason: none of them is
 * what identifies a control, its state, or a graphic's value.
 */
export const UNMEASURED_MARKS: Readonly<Partial<Record<ThemeSlot, string>>> = {
  "--color-panel-border": "panels hold content; they aren't controls",
  "--toggle-frame-border-color":
    "the frame groups toggles its items' labels identify; the pressed item is measured",
  "--color-chip-hairline":
    "a sport chip is identified by its label and dot, and a selected chip by its sport fill, which the sport palette's tests hold to 3:1",
  "--slider-track-bg": "a slider's filled track and handle carry its value, and are measured",
  "--color-meter-todo": "a meter's done segments are measured, and its text states the same count",
};
