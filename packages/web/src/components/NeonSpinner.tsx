import { useId } from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "./theme/useThemeStructure";

/** Neon colors for random spinner selection */
const NEON_COLORS = [
  "var(--color-neon-cyan)",
  "var(--color-neon-magenta)",
  "var(--color-neon-green)",
  "var(--color-neon-purple)",
] as const;

interface NeonSpinnerProps {
  /** Size variant: default or text-sm */
  size?: "default" | "sm";
  /** Additional CSS classes */
  className?: string;
}

/**
 * The app's loading indicator, in whichever shape the theme's `loaderStyle` asks for: a
 * spinning ring, a chaser of lit segments, or a row of blocks with a cursor. Every variant
 * keeps the same role, label and size options, so the 20-odd call sites never choose.
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
  const { loaderStyle } = useThemeStructure();

  if (loaderStyle === "chaser" || loaderStyle === "block") {
    const segments = loaderStyle === "chaser" ? 8 : 10;
    const small = size === "sm";
    return (
      <div
        className={cn("inline-flex items-center", small ? "gap-[2px]" : "gap-[3px]", className)}
        role="status"
        style={{ color }}
      >
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={cn(
              "loader-segment inline-block bg-current",
              loaderStyle === "chaser"
                ? small
                  ? "h-[4px] w-[9px]"
                  : "h-[6px] w-[14px]"
                : small
                  ? "size-[5px]"
                  : "size-[8px]"
            )}
            // Each segment lights in turn; the stagger is what makes it read as travel
            // rather than a blink. Held still under reduced motion by the rule in the
            // stylesheet, which leaves the segments at rest opacity.
            style={{ animationDelay: `${(i * 0.9) / segments}s` }}
          />
        ))}
        {loaderStyle === "block" && (
          <span
            className={cn(
              "loader-cursor inline-block bg-current",
              small ? "h-[7px] w-[4px]" : "h-[11px] w-[6px]"
            )}
          />
        )}
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-block animate-spin rounded-full border-solid border-current border-e-transparent align-text-bottom [animation-duration:0.75s] motion-reduce:animate-none",
        size === "sm" ? "size-4 border-[0.2em]" : "size-8 border-[0.25em]",
        className
      )}
      role="status"
      style={{ color }}
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}
