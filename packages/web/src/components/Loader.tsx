import { cn } from "@/lib/utils";
import { SectionLabel } from "./theme/SectionLabel";
import { useThemeStructure } from "./theme/useThemeStructure";

interface LoaderProps {
  /** `sm` draws smaller segments, for a loader inline in a list or a short panel. */
  size?: "default" | "sm";
  /** What's loading, shown beside the loader and announced; "Loading…" unless given. */
  label?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * The app's loading indicator, in whichever shape the theme's `loaderStyle` asks for: a
 * chaser of lit segments, or a row of blocks with a cursor after the label. Segments light
 * in the theme's `--color-meter-done`, as the loader reuses the meter's look. Both shapes
 * keep the same role, label and size options, so the call sites never choose.
 *
 * @example
 * // Default size
 * <Loader />
 *
 * // Small size (for inline use), naming what loads
 * <Loader size="sm" label="Loading map…" />
 */
export default function Loader({
  size = "default",
  label = "Loading…",
  className = "",
}: LoaderProps) {
  const { loaderStyle } = useThemeStructure();

  const segments = loaderStyle === "chaser" ? 8 : 10;
  const small = size === "sm";
  return (
    <div
      className={cn("inline-flex items-center", small ? "gap-2" : "gap-3", className)}
      role="status"
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex items-center text-(--color-meter-done)",
          small ? "gap-[2px]" : "gap-[3px]"
        )}
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
      </span>
      <SectionLabel className="inline-flex items-center gap-1 text-(color:--color-muted-text)">
        {label}
        {loaderStyle === "block" && (
          <span
            aria-hidden="true"
            className={cn(
              "loader-cursor inline-block bg-(--color-meter-done)",
              small ? "h-[7px] w-[4px]" : "h-[11px] w-[6px]"
            )}
          />
        )}
      </SectionLabel>
    </div>
  );
}
