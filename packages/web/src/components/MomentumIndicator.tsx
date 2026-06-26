import type { MomentumLevel } from "../utils/trainingMomentum";

interface MomentumIndicatorProps {
  momentumLevel: MomentumLevel;
  trainingMomentum: number | null;
}

function getSymbol(level: MomentumLevel): string {
  if (level === "stale") return "✕";
  if (level === "significantly-up" || level === "up") return "↑";
  if (level === "steady") return "─";
  return "↓";
}

function getDescription(level: MomentumLevel, momentum: number | null): string {
  if (level === "stale") {
    return "Training Momentum: No recent activity\n\nNo activity recorded in the last 7 days. Momentum indicator is not available.";
  }

  if (momentum === null) return "";

  const sign = momentum >= 0 ? "+" : "";
  const percentage = `${sign}${momentum.toFixed(1)}%`;

  const trendMap: Record<string, string> = {
    "significantly-up": "Significantly ramping up",
    up: "Ramping up",
    steady: "Steady pace",
    down: "Slightly declining",
    "significantly-down": "Declining",
  };
  const trend = (level && trendMap[level]) ?? "";

  return `Training Momentum: ${trend}\n${percentage} per week (14-day trend)\n\nShows whether your daily pace is accelerating, steady, or slowing down over the last 2 weeks.`;
}

export default function MomentumIndicator({
  momentumLevel,
  trainingMomentum,
}: MomentumIndicatorProps) {
  const description = getDescription(momentumLevel, trainingMomentum);
  return (
    // The glyph carries meaning, so expose it as a labeled image: `aria-label`
    // gives screen readers the full description (the symbol alone is opaque to
    // them), and `title` keeps the visual hover tooltip for sighted mouse users.
    // No `tabIndex` — it's non-interactive (no action), so it stays out of the tab
    // order (and `role="img"` + tabindex would trip jsx-a11y anyway).
    <span
      role="img"
      aria-label={description}
      style={{
        // slate-lighter (not slate-light): clears WCAG 4.5:1 on the body bg in BOTH
        // themes for this small glyph; slate-light fails in light mode (~4.3:1).
        color: "var(--color-slate-lighter)",
        fontSize: "0.9em",
        marginLeft: "4px",
        cursor: "help",
        textDecoration: "underline dotted",
      }}
      title={description}
    >
      {getSymbol(momentumLevel)}
    </span>
  );
}
