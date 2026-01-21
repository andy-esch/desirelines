import { useMemo } from "react";
import { NEON } from "../constants/uiColors";

/**
 * Neon colors for the spinner - uses centralized NEON palette
 */
const NEON_COLORS = [NEON.CYAN, NEON.MAGENTA, NEON.GREEN, NEON.PURPLE] as const;

interface NeonSpinnerProps {
  /** Size variant: default or small */
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
  // Select a random color once on mount
  const color = useMemo(() => {
    const index = Math.floor(Math.random() * NEON_COLORS.length);
    return NEON_COLORS[index];
  }, []);

  const sizeClass = size === "sm" ? "spinner-border-sm" : "";

  return (
    <div
      className={`spinner-border ${sizeClass} ${className}`.trim()}
      role="status"
      style={{ color }}
    >
      <span className="visually-hidden">Loading...</span>
    </div>
  );
}
