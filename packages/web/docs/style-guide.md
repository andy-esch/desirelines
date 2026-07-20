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
`--color-chart-mark-outline`, `--color-chip-hairline`, `--color-sport-on`, `--color-on-neon`.

**3. Components** — consume roles only. **No component may name a raw color value.**
Exceptions are pure white/black and generic neutrals (`#666` fallbacks, black shadows),
which are not theme decisions.

To re-theme the app, edit layer 1 and the light overrides. That is the whole point of the
layering; if a change requires touching component files, the layering has been violated.

### Helpers

`src/utils/colorTokens.ts` — `tint(token, pct)` and `alpha(color, pct)` emit `color-mix`;
use them instead of writing `rgba()` literals. `resolveThemeColor(token, fallback)` reads a
resolved value for consumers that cannot take `var()` (Mapbox style expressions, numeric
interpolation, `<meta>` tags). It is a point-in-time read — callers that must react to theme
changes depend on `useTheme().resolvedTheme`.

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

Dark is the `:root` default; light is an override under `html:not(.dark)`. **There are no
`dark:` Tailwind utilities in this app** — theme differences go through tokens, or through
an `html:not(.dark)`-scoped rule when a token cannot express it.

`ThemeProvider` applies the class eagerly on change (not only in an effect), because
consumers that read resolved token values would otherwise render one theme behind.

## Components

**Buttons:** `.btn-accent` (primary CTA, max one per section), `.btn-outline-slate`
(secondary), `.btn-ghost-slate` (tertiary), `.btn-time-range` (toggle groups). Also
available: `.btn-secondary`, `.btn-icon`, `.btn-link`, `.btn-close`, `.btn-sm`,
`.btn-group`, and `.btn-outline-{danger,success,warning,secondary}`.

**Links:** cyan, no underline. Hover: magenta underline.

**Focus:** cyan ring via `--color-accent-cyan`.

**Cards / glass panels:** `--color-slate-light` border, lightens on hover.

**Neon pills:** `.pill-neon` + `.pill-neon-dot` — the map deep-link pill and the
active-filter pill. Theme-aware via the decorative tokens; do not add elevation utilities
(rule 5).

**Sport chips:** `sportChipClass` + `<SportChipDot />` from `src/components/sportChip.tsx`.

**Demo banner:** `.alert-demo`.

**shadcn/Base UI primitives** ship modern-neutral and are themed onto our tokens via the
`@theme inline` alias block in `tailwind.css`. New primitives need that mapping, not their
own palette.

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
| `src/css/tailwind.css` | **Source of truth** — primitives, role tokens, light overrides, component classes |
| `src/utils/sportConfig.ts` | `SPORT_COLORS` — per-sport data palette |
| `src/utils/colorTokens.ts` | `tint` / `alpha` / `resolveThemeColor` helpers |
| `src/constants/chartColors.ts` | Goal-ladder + data-line colors (distinct from sport colors) |
| `src/constants/sportGradients.ts` | Per-sport page backdrops, derived from `SPORT_COLORS` |

## Known drift

Candidates for pull-back toward the direction, not yet scheduled:

- The shadcn migration left several primitives reading modern-neutral rather than neon.
- `--color-sport-on` (`#0b1120`) and `--color-on-neon` (`#1a202c`) duplicate one job.
- Sparkline and map line marks are distinguished by hue alone (rule 6).
- Thin neon marks — sparkline dashes, `RaceTrack` bars — remain low-contrast on light.
