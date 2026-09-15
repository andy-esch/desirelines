# Desirelines Style Guide

The north star for UI work. New work gets checked against this; when reality and this
document disagree, one of them is a bug.

## Direction

**80s / neon, and unapologetic about it** — lasers, acid brightness, glow, synthwave. The
failure mode to guard against is drift toward generic "modern slick" web design: muted
palettes, tasteful greys, safe neutrals. That drift is usually justified as accessibility,
and that justification is wrong — see the first rule below.

Restraint applies to **legibility**, not to **intensity**. Text must be readable and marks
must be distinguishable; neither requires dimming the palette.

## The color system

Three layers. Each may reference the layer above it, never below.

**1. Primitives** — the raw brand values, stated once, in `src/css/tailwind.css`. These do
not change with the theme.

| Token | Value |
| --- | --- |
| `--color-brand-cyan` | `#00d4ff` |
| `--color-neon-cyan` | `rgb(0, 255, 255)` |
| `--color-neon-magenta` | `rgb(255, 0, 255)` |
| `--color-neon-purple` | `rgb(180, 0, 255)` |
| `--color-neon-green` | `rgb(0, 255, 128)` |
| `--color-neon-yellow` | `rgb(255, 200, 0)` |
| `--color-neon-orange` | `rgb(255, 95, 31)` |
| `--color-neon-lime` | `#39ff14` |

**2. Roles** — what a color *means*. These flip with the theme. There are three separate
accent roles and conflating them is the most common mistake:

| Role | Token | Job |
| --- | --- | --- |
| Interactive | `--color-accent-cyan` | Links, buttons, focus. **Mutes to a WCAG-safe teal `#0891b2` in light** so controls stay legible. |
| Decorative | `--color-neon-accent` (+ `-border`, `-glow`) | Pill borders, glows, status dots. **Stays bright in light (`#00b8e6`)** — it must not inherit the interactive mute. |
| Data | `SPORT_COLORS` (`src/utils/sportConfig.ts`) | Encodes which sport a mark is. Never chrome. |

Plus the scaffolding that makes full-brightness neon legible:
`--color-chart-mark-outline`, `--color-chip-hairline`, and `--color-on-accent` (the ink for a
label sitting *on* a neon fill).

Neutrals are named for their job, never their hue, so a theme can set each independently (heavy
black panel borders with grey muted text, say):

| Token | Job |
| --- | --- |
| `--color-muted-text` / `--color-subtle-text` | Secondary copy; subtle reads one step stronger |
| `--color-surface-raised` | Cards, popovers and pills lifted off the page ground |
| `--color-control-bg` / `--color-control-border` (+ `-hover`) | Form fields and outlined controls |
| `--color-divider` | Rules inside a surface |
| `--color-panel-border` (+ `-hover`) | The outline of a panel or card |
| `--color-fill-muted` (+ `-hover`) | Neutral fills: secondary buttons, the active toggle |
| `--color-intensity-0` | The calendar heatmap's "no activity" cell |

Two groups stay fixed across themes: the header chrome, whose brightest ink
`--color-header-ink` is used at partial alpha (`text-header-ink/50`, `bg-header-ink/10`),
and `--color-scrim` / `--color-on-scrim`, the darkening layer for modal backdrops, menu
shadows and a label drawn over a bright fill (`bg-scrim/50`, `shadow-scrim/40`).

**3. Components** consume roles only. **No component may name a raw color value, and no
component may use Tailwind's built-in palette utilities** (`text-white`, `bg-black/50`,
`border-slate-500`): they bypass the theme blocks, so they look right in one theme and wrong
in the next. `colorUtilities.test.ts` fails on either. The one exception is a fallback literal
for a data color that failed to arrive (e.g. a chart tooltip's `#888`).

To re-theme the app, edit layer 1 and the theme blocks. That is the whole point of the
layering; if a change requires touching component files, the layering has been violated.

### Helpers

`src/utils/colorTokens.ts` — `tint(token, pct)` and `alpha(color, pct)` emit `color-mix`;
use them instead of writing `rgba()` literals. `resolveThemeColor(token, fallback)` reads a
resolved value for consumers that cannot take `var()` (Mapbox style expressions, numeric
interpolation, `<meta>` tags). It is a point-in-time read — callers that must react to theme
changes depend on `useTheme().theme.id`.

## Rules

**1. Neon is an accent, never the text.** A sport-colored control pairs a *neutral* label
with a glowing color dot, a hairline mixed toward the color, and a full-brightness fill when
selected. Because the color never carries the legibility burden, it never has to be dimmed
to earn it. This replaces the old "full NEON = charts only, UI = toned-down" rule, which was
itself a driver of the drift.

Reference implementation: `src/components/sportChip.tsx`.

**2. Every neon mark needs a boundary in light mode.** On the light ground several sport
colors sit at ~1:1 contrast — `golf` and `racket_sports` are literally invisible without
one. Any mark painted in a sport color gets `.sport-mark` (or the equivalent stroke/ring),
which resolves to ink in light and to the page ground — imperceptible — in dark.

Dark has no such fallback, so the palette itself is floored at 3:1 against the dark ground.

**3. Color follows the entity, never its rank.** A sport's color is fixed. Never derive it
from position among the currently-visible sports: filtering would repaint the survivors.

**4. Past ~8 simultaneous series, color stops working.** No palette discriminates beyond
that. Fold the tail into "Other", facet, or use small multiples — do not generate more hues.

**5. A Tailwind utility beats a component class.** The utilities layer wins over the
components layer, so `shadow-lg` on an element silently replaces a `.pill-neon` glow, and
`border-transparent` kills a mark outline. When a component class provides decorative neon,
check that no utility on the same element overrides it. This has bitten twice.

**6. Identity is never carried by color alone.** Labels, legends, and text carry meaning;
color reinforces it.

## The sport palette

16 fixed per-sport colors in `src/utils/sportConfig.ts`. They were computed, not chosen:
greedy farthest-point selection maximizing worst-case CIE76 ΔE across normal vision,
deuteranopia and protanopia, with a 3:1 dark-ground contrast floor.

Invariants, enforced by `src/utils/sportConfig.test.ts`:

- every sport in `schemas/sports/sport_types.json` has a color
- no duplicates
- every pair ≥ 12 ΔE under both dichromacies (the shipped palette is at 15.3)
- every color ≥ 3:1 against the dark ground

**If you change a value here, the tests are the check** — the constraints are invisible in
normal vision.

## Theming

The app has a list of themes, not a dark/light switch. The active theme is a
`data-theme="<id>"` attribute on `<html>`, and a theme is **values only**: nothing in a
component knows which theme is active. **There are no `dark:` Tailwind utilities and no
theme-id checks in components** — anything that differs between themes is a token value or
a field on the theme's list entry.

A theme is two halves that must agree:

1. **A CSS block** — `[data-theme="<id>"] { … }` in `src/css/tailwind.css`, redefining the
   full set of theme-varying tokens. Every block defines the *same* set: `data-theme` can
   also theme a subtree (the dev gallery does), and a block that omitted a token would
   silently inherit the outer theme's value there. Tokens derived from another token (a
   `color-mix` of the accent, say) are redefined too, because custom properties resolve
   `var()` where they are declared.
2. **A list entry** — in `src/themes/registry.ts`: `id`, `label`, `scheme` (`dark` / `light`,
   which sets `color-scheme` and decides what "System" resolves to), `mapStyle` (the routes
   map's Mapbox style), `hidden`, `background` (must equal the block's `--color-bg-body`),
   picker `swatches`, `fonts` (the faces to preload, which must appear in the block's font
   stacks), and `structure` (the choices that change markup; see "Theme slots").

### Theme slots

Beyond colors, a theme sets **slots**: non-color CSS variables for type, shape, depth and
decoration, plus a few **structure fields** on its list entry for choices that add or remove
markup. Components read slots and fields; they never check which theme is active. Every
block defines every slot. Legacy dark and Legacy light carry today's values, so a slot a
component doesn't read yet changes nothing. The dev gallery lists each theme's resolved
slot values.

| Group | Slots | Controls |
|---|---|---|
| Type | `--font-body`, `--font-display`, `--font-chart`, `--display-weight` | Faces for UI text, display text (wordmark, titles, big numbers) and chart labels |
| Page titles | `--page-title-size`, `-color`, `-shadow`, `-case`, `--display-text-gradient` | The page `h1`; the gradient is `none` where titles are solid |
| Labels | `--kicker-size`, `-tracking`, `-color`; `--label-size`, `-tracking`, `-color`, `-case`; `--data-label-case` | The line above a title, section labels, and the case of sport names in rows |
| Numbers | `--table-text-size`, `--stat-value-size`, `--stat-value-size-wide`, `--stat-value-shadow` | Table text and big stat numbers (wide = from `md` up) |
| Wordmark | `--wordmark-font`, `-size`, `-weight`, `-tracking`, `-case`, `-color`, `-color-2`, `-slash-color`, `-slash-size`, `-slash-weight`, `-shadow` | The logo's two words and slash |
| Header | `--header-height`, `-border`, `-shadow-scrolled`; `--nav-size`, `-tracking`, `-case`, `-active-bg`, `-active-radius`, `-active-underline`, `-active-shadow`; `--avatar-radius`, `-border`, `-glow`; `--demo-rule` | The top bar, nav items, avatar and the demo banner's rule |
| Backgrounds | `--page-wash-strength`, `--sport-wash-strength`, `--hero-padding`, `--glass-blur`, `--glass-blur-sm`, `--progress-shine` | Page and sport gradient strength (0 turns a wash off), hero padding, frosted-glass blur for map chrome and for small floating pills (0 makes them solid), progress-bar shine |
| Panels | `--radius`, `--panel-bg`, `-border-width`, `-radius`, `-shadow`, `-shadow-emphasis`, `-padding`, `-header-padding`, `-body-padding`, `-accent-1/2/3`; `--divider-style` | Cards and panels, including the base radius the shadcn scale derives from |
| Controls | `--control-height`, `-radius`, `-font-size`, `-case`, `-focus-ring`; `--toggle-gap`, `-frame-border-width`, `-frame-padding`, `-frame-radius`, `-item-border-width`, `-item-radius`, `-font-size`, `-tracking`, `-case`; `--button-radius`, `-case`, `-tracking`; `--stepper-gap` | Inputs, selects, toggle groups, buttons and steppers (height and font size are the default size; `sm` and `lg` buttons and caller overrides keep fixed sizes) |
| Sliders and chips | `--slider-track-height`, `-track-radius`, `-handle-size`, `-handle-radius`, `-handle-border-width`; `--chip-radius`, `-border-strength`, `-hover-strength`, `-dot-radius` | Range sliders and sport chips (strengths are how much sport color mixes in) |
| Tables | `--th-size`, `--th-tracking`, `--th-rule`, `--row-rule`, `--row-padding`, `--row-hover-bg`, `--missing-value-color`, `--sport-mark-radius` | Table headers, row rules and hover, empty cells, sport marks |
| Goals and meters | `--track-height`, `-bg`, `-border`, `-fill-height`, `-radius`; `--pace-tick-width`, `-height`; `--meter-segment-width`, `-segment-height`, `--meter-gap`, `--meter-radius`; `--cell-empty-border`, `--cell-radius` | Goal tracks and their pace tick, segmented meters, heatmap cells |
| Charts | `--chart-baseline`, `--chart-tick-size`, `--chart-actual-glow`, `--chart-average-dash`, `--chart-bar-radius`, `--chart-bar-gap`, `--chart-hover-column`, `--tooltip-radius` | Chart chrome beyond the color tokens |
| Map chrome | `--map-chrome-bg`, `-edge`, `-shadow`; `--popup-radius`, `--popup-border` | The routes-map drawers, toggles and route popup |

Structure fields (`structure` on the list entry):

| Field | Values | Changes |
|---|---|---|
| `showPageKicker` | `true` / `false` | Renders the kicker line above page titles |
| `heroDecoration` | `none`, `sunset`, `grid` | The dashboard hero's decoration, and the Settings preview thumbnail |
| `sectionLabelPlacement` | `card-header`, `above`, `header-bar` | Where a panel's title goes |
| `statRowStyle` | `cards`, `divided`, `boxed` | How a row of big numbers is framed |
| `sliderTrack` | `continuous`, `segmented` | Slider tracks as a bar or a segmented meter |
| `rowHoverCursor` | `true` / `false` | A cursor glyph on the hovered table row |
| `sportMarkStyle` | `badge`, `dot`, `swatch` | How a sport is marked in rows and lists |
| `statusSymbolStyle` | `badge`, `filled`, `outlined` | Goal status as colored badges or an SVG symbol plus text |
| `goalTrackStyle` | `bar-with-percent`, `track`, `outline-track` | Goal progress drawing |
| `meterPartialCurrent` | `true` / `false` | Year meters fill the current segment to today |
| `loaderStyle` | `spinner`, `chaser`, `block` | The loading indicator |
| `dangerZoneFill` | `wash`, `hatch` | The pacing charts' danger zone |
| `chartMarkerShape` | `circle`, `square` | Axis marker dots |
| `chartLegend` | `true` / `false` | A legend row above line charts |
| `mapDrawerSections` | `flat`, `panels` | Routes-map drawer section framing |
| `dateFormat` | `short`, `dotted` | `Sep 12, 2026` or `2026.09.12`; integers are never zero-padded |

**Fonts.** `tailwind.css` imports every face a theme can use (Space Grotesk, IBM Plex Mono
400/500/600, Archivo Black, Michroma). Declaring a face costs nothing: the browser downloads
it only when rendered text uses it, so a theme that never names Plex Mono never fetches it.
`themeCss.test.ts` checks that each entry's `fonts` appear in its block's font stacks and
that every web face a block leads with has an import.

**Derived slot values.** A slot built with `color-mix()` over another token gets a fallback
from the CSS build for browsers without `color-mix(in lab)` support, and that fallback uses
the `@theme` default rather than the theme block's own token. Current browsers are
unaffected. If a theme's derived slot must be exact everywhere, give it a literal value.

The page washes scale by `--page-wash-strength` with a nested mix,
`color-mix(in srgb, color-mix(in srgb, <color> 18%, transparent) calc(100% * <strength>), transparent)`,
rather than a `calc()` inside a single mix. The build can resolve the inner literal
percentage for its fallback; with the `calc()` inline, the fallback lost the percentage and
rendered the neon at full strength.

### Adding a theme

1. Add the entry with `hidden: true`, so it stays out of the picker while in progress.
2. Add the CSS block, copying an existing block's token list and changing the values.
3. Review it at `/dev/themes` (dev server only), where every theme — hidden ones included —
   renders side by side.
4. Release it by flipping `hidden` to `false`.

The checks run with the web tests: `themeCss.test.ts` fails on a theme without a block, a
block without a theme, blocks with differing token sets, or a `background` that doesn't
match `--color-bg-body`; `sportConfig.test.ts` holds `SPORT_COLORS` to 3:1 against every
dark theme's background; `bootScript.test.ts` keeps the first-paint script in step with
`ThemeProvider`.

### Retiring a theme

A theme being phased out stays **values only** until it is deleted: a CSS block and a list
entry, nothing else — no selectors or tokens of its own, no id checks. When a shared change
can't be expressed through the shared tokens, the retiring theme takes the shared default
and drifts from how it used to look. The first time it would need a special case, delete
it instead.

### First paint and switching

`index.html` carries a placeholder that `vite.config.ts` replaces with a script generated
from the theme list (`src/themes/bootScript.ts`). It applies the stored preference —
including the old `dark` / `light` values — before the stylesheet loads, so the page never
flashes the wrong theme, and it can't drift from the list because nobody hand-writes it.

`ThemeProvider` applies the attribute eagerly on change (not only in an effect), because
consumers that read resolved token values would otherwise render one theme behind.

## Components

**Theme components** (`src/components/theme/`) are how new UI should be built. Each reads
theme slots, role tokens and the theme's structure fields, never the theme id, so a new
theme changes them through values alone. Structure comes from `useThemeStructure()`: the
active theme's `structure`, unless a `ThemeStructureProvider` overrides it for a
`data-theme` subtree (the dev gallery wraps each theme panel this way).

| Component | Reads | Notes |
|---|---|---|
| `Panel` | `--panel-*`, `sectionLabelPlacement` | Title in a card header, a label above the frame, or a header bar inside it. `accent` picks one of three frame accents; `emphasis` marks the panel that should stand out. |
| `SectionLabel` | `--label-*` | Section and panel labels. |
| `Stat`, `StatRow` | `--stat-*`, `--font-display`, `--display-weight`, `statRowStyle` | A row frames its stats as separate cards, one divided panel, or outline boxes. |
| `Meter` | `--meter-*`, `--color-meter-*`, `--track-*`, `--color-pace-tick`, `meterPartialCurrent`, `goalTrackStyle` | Segmented (months, weeks) or continuous with an optional pace tick. `indeterminate` animates the segments for loading, and stops under reduced motion. |
| `StatusSymbol` | `--status-*`, `--color-status-*`, `statusSymbolStyle` | A goal status as an SVG symbol plus text, or the old colored badge where a theme keeps badges. The words always show. |

The component slots and tokens: `--panel-accent-{1,2,3}-ink` (header-bar label color per
accent), `--stat-label-size`, `--stat-label-tracking`, `--stat-label-case`, `--stat-sub-size`,
`--stat-sub-color`, `--color-meter-done`, `--color-meter-current`, `--color-meter-todo`,
`--meter-done-glow`, `--meter-current-glow`, `--color-pace-tick`, `--color-status-good`,
`--color-status-warn`, `--color-status-bad`, `--status-size`, `--status-tracking` and
`--status-case`. `/dev/themes` shows every component in every theme, plus a structure
preview of each structure a theme can choose.

**Buttons:** the shadcn `Button` for new UI. Bootstrap-era classes still in use:
`.btn-outline-slate` (secondary), `.btn-ghost-slate` (tertiary), `.btn-time-range` (toggle
groups), `.btn-secondary`, `.btn-icon`, `.btn-link`, `.btn-close`, `.btn-sm`, `.btn-group`,
and `.btn-outline-{danger,success,warning,secondary}`.

**Links:** cyan, no underline. Hover: magenta underline.

**Focus:** cyan ring via `--color-accent-cyan`.

**Cards / glass panels:** `--color-panel-border` border, `--color-panel-border-hover` on hover.

**Neon pills:** `.pill-neon` + `.pill-neon-dot` — the map deep-link pill and the
active-filter pill. Theme-aware via the decorative tokens; do not add elevation utilities
(rule 5).

**Sport chips:** `sportChipClass` + `<SportChipDot />` from `src/components/sportChip.tsx`.

**Demo banner:** `.alert-demo`.

**shadcn/Base UI primitives** (`src/components/ui/`) take colors from the `@theme inline`
alias block in `tailwind.css` (`bg-card`, `border-input`, `data-[pressed]:bg-primary`) and
geometry and type from the control slots: `Button`, `Input`, `SelectTrigger` and the
`Combobox` chips box read `--control-height`, `--control-radius` (`--button-radius` for
buttons) and `--control-font-size`; `ToggleGroup` reads `--toggle-*`; `Slider` reads
`--slider-*`. New primitives follow the same split. Two things to watch:

- Keep color in utilities, not slots. A slot whose value is `var(--color-…)` resolves where
  the theme block defines it, so a subtree that remaps a color token (the routes-map chrome
  does) never sees the remap. Slots hold widths, sizes, radii and case; the color stays a
  utility on the element.
- Don't style pressed or selected states with `box-shadow`. The focus ring is a
  `box-shadow` (`ring-*`), so a pressed shadow hides the ring on the focused item. Use
  background, border or text color for pressed states.
- Popups render in a portal on `<body>`. Select, combobox, popover and tooltip content sits
  outside the drawer or `data-theme` subtree that opened it, so a token remap on that
  subtree (`MAP_CHROME_STYLE`, the gallery's theme panels) doesn't reach the popup. Apply
  the remap to the popup as well where it matters.
- Raise `--control-height` along with `--control-font-size`. The primitives keep text-sm's
  line-height ratio, so larger control text needs a taller control.

**Selects:** `StyledSelect` (options list plus `onChange`) or the `Select` primitives. There
is no native `<select>` styling; don't reintroduce `.form-select`.

## Neon treatments

The vocabulary for "make this feel like the direction". All of these are **decorative**, so
rules 1, 5 and 6 apply: never the only carrier of meaning, and check that no Tailwind utility
on the same element overrides them.

| Utility | Effect | Reach for it when |
| --- | --- | --- |
| `neon-gradient-text` | Magenta → cyan → green clipped to text | Page-level titles and hero numbers. One per view; it stops reading as special if repeated. |
| `neon-glow-cyan` / `-pink` / `-green` | Solid neon + layered text-shadow | A single emphatic value or label. Not body copy — the glow costs legibility at small sizes. |
| `neon-backdrop` | Low-alpha gradient wash via `::before` | Giving a panel atmosphere without competing with its contents. |
| `page-bg-*` | Per-view gradient ground | Already applied per route; extend the set rather than inventing a one-off. |
| `.pill-neon` + `.pill-neon-dot` | Bordered pill with glow and a live dot | Floating status/filter indicators. |
| `.sport-mark` | Theme-aware boundary on a sport-colored mark | Any data mark. Not decorative — required, see rule 2. |

**Where intensity belongs:** page grounds, chrome that frames content (pills, rules,
dividers), state changes (focus, active, selected), and single hero values. Loud framing
around calm content is the house style.

**Where restraint belongs:** running text, dense tables, and anything a user reads for more
than a moment. Restraint here means *not applying an effect* — it does not mean reaching for
a duller color. If a surface feels illegible, the fix is a neutral label or a boundary
(rules 1 and 2), not a muted palette. That distinction is the whole thesis: the palette
stays acid; the scaffolding does the work.

**A treatment is not a token.** These utilities compose primitives; they don't define colors.
Adding a new effect means adding a utility here, never a literal in a component.

## Files

| File | Purpose |
| --- | --- |
| `src/css/tailwind.css` | **Source of truth** — primitives, role tokens, theme blocks, component classes |
| `src/themes/registry.ts` | The theme list — ids, labels, scheme, map style, release state |
| `src/themes/bootScript.ts` | First-paint theme script, generated into `index.html` at build |
| `src/pages/dev/ThemeGalleryPage.tsx` | Dev-only side-by-side theme gallery at `/dev/themes` |
| `src/utils/sportConfig.ts` | `SPORT_COLORS` — per-sport data palette |
| `src/utils/colorTokens.ts` | `tint` / `alpha` / `resolveThemeColor` helpers |
| `src/constants/chartColors.ts` | Goal-ladder + data-line colors (distinct from sport colors) |
| `src/constants/sportGradients.ts` | Per-sport page backdrops, derived from `SPORT_COLORS` |

## Known drift

Candidates for pull-back toward the direction, not yet scheduled:

- The shadcn migration left several primitives reading modern-neutral rather than neon.
- Sparkline and map line marks are distinguished by hue alone (rule 6).
- Thin neon marks — sparkline dashes, `RaceTrack` bars — remain low-contrast on light.
