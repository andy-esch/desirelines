# Desirelines Style Guide

Quick reference for the NEON-inspired design system.

## Colors

### UI Colors (toned-down)

| Variable              | Hex                    | Use                   |
| --------------------- | ---------------------- | --------------------- |
| `--slate-dark`        | `#2d3748`              | Header bg             |
| `--slate`             | `#4a5568`              | Borders, cards        |
| `--slate-light`       | `#718096`              | Muted text            |
| `--slate-lighter`     | `#a0aec0`              | Subtle text           |
| `--accent-cyan`       | `#00d4ff`              | Links, buttons, focus |
| `--accent-cyan-hover` | `#00b8e6`              | Hover states          |
| `--accent-cyan-glow`  | `rgba(0,212,255,0.15)` | Focus rings           |
| `--accent-magenta`    | `#ff00ff`              | Link underlines only  |

### Chart Colors (full NEON - data only)

| Color      | RGB              | Goal         |
| ---------- | ---------------- | ------------ |
| Cyan       | `rgb(0,255,255)` | Conservative |
| Green-Cyan | `rgb(0,255,128)` | Moderate     |
| Magenta    | `rgb(255,0,255)` | Target       |
| Yellow     | `rgb(255,200,0)` | Ambitious    |
| Pink       | `rgb(255,0,128)` | Stretch      |

## Buttons

| Class                | Use                        | Example           |
| -------------------- | -------------------------- | ----------------- |
| `.btn-accent`        | Primary CTA (1-2 per page) | Sign In, Try Demo |
| `.btn-outline-slate` | Secondary actions          | Add Goal, Edit    |
| `.btn-ghost-slate`   | Tertiary/minor             | Load More, Cancel |
| `.btn-time-range`    | Toggle groups              | Time selectors    |

## Components

**Links:** Cyan, no underline. Hover: magenta underline.

**Focus:** Cyan border + `--accent-cyan-glow` ring.

**Cards:** `--slate-light` border, lightens on hover.

**Progress bars:** `.progress-neon` + `.progress-bar-neon` with dynamic glow.

**Demo banner:** `.alert-demo` - transparent cyan tint.

## Rules

- Full NEON = charts only
- UI = toned-down cyan/magenta
- Max 1 `.btn-accent` per section
- Update both `variables.css` and `uiColors.ts` when changing colors

## Files

| File                           | Purpose                         |
| ------------------------------ | ------------------------------- |
| `src/css/variables.css`        | CSS variables (source of truth) |
| `src/css/dashboard.css`        | Component styles                |
| `src/constants/uiColors.ts`    | TypeScript constants            |
| `src/constants/chartColors.ts` | Chart NEON colors               |
