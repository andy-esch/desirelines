import { useId } from "react";

/** Neon colors for random spinner selection */
const NEON_COLORS = [
  "rgb(0, 255, 255)",
  "rgb(255, 0, 255)",
  "rgb(0, 255, 128)",
  "rgb(180, 0, 255)",
] as const;

interface NeonSpinnerProps {
  /** Size variant: default or text-sm */
  size?: "default" | "sm";
  /** Additional CSS classes */
  className?: string;
}

/**
 * A Bootstrap spinner with a randomly selected neon color.
 *
 * The color is selected once when the component mounts and remains
 * stable for the lifetime of the component (no flashing on re-renders).
 *
 * @example
 * // Default size
 * <NeonSpinner />
 *
 * // Small size (for inline use)
 * <NeonSpinner size="sm" />
 */
export default function NeonSpinner({ size = "default", className = "" }: NeonSpinnerProps) {
  // Derive a stable color from the component's unique ID.
  // useId() is SSR-safe, Strict Mode-safe, and pure (no module-level mutation).
  const id = useId();
  const hash = Array.from(id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const color = NEON_COLORS[hash % NEON_COLORS.length];

  const sizeClass = size === "sm" ? "spinner-border-sm" : "";

  return (
    <div
      className={`spinner-border ${sizeClass} ${className}`.trim()}
      role="status"
      style={{ color }}
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}
