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

  let trend = "";
  if (level === "significantly-up") trend = "Significantly ramping up";
  else if (level === "up") trend = "Ramping up";
  else if (level === "steady") trend = "Steady pace";
  else if (level === "down") trend = "Slightly declining";
  else if (level === "significantly-down") trend = "Declining";

  return `Training Momentum: ${trend}\n${percentage} per week (14-day trend)\n\nShows whether your daily pace is accelerating, steady, or slowing down over the last 2 weeks.`;
}

export default function MomentumIndicator({
  momentumLevel,
  trainingMomentum,
}: MomentumIndicatorProps) {
  return (
    <span
      style={{
        color: "#888",
        fontSize: "0.9em",
        marginLeft: "4px",
        cursor: "help",
        textDecoration: "underline dotted",
      }}
      title={getDescription(momentumLevel, trainingMomentum)}
    >
      {getSymbol(momentumLevel)}
    </span>
  );
}
