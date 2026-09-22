import * as React from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "../theme/useThemeStructure";

/**
 * Slider — shadcn-style wrapper over Base UI's Slider, themed via the `@theme`
 * shim. Supports single-thumb (`value={n}`) and **range** (`value={[lo, hi]}`,
 * e.g. the distance/time-range filters); thumb count is derived from the value.
 */
type StringClass<T> = Omit<T, "className"> & { className?: string };

function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  getAriaValueText,
  ...props
}: StringClass<React.ComponentProps<typeof BaseSlider.Root>> & {
  /** Localized per-thumb `aria-valuetext` for screen readers (e.g. "50 mi" or a date)
   *  instead of the raw internal number. Forwarded to each thumb's input. */
  getAriaValueText?: (formattedValue: string, value: number, index: number) => string;
}) {
  // Render one thumb per value (controlled or uncontrolled); fall back to a single
  // thumb at `min` when neither is provided.
  const thumbValues = React.useMemo<number[]>(() => {
    const source = value ?? defaultValue;
    if (Array.isArray(source)) return source as number[];
    if (typeof source === "number") return [source];
    return [min];
  }, [value, defaultValue, min]);

  const { sliderTrack } = useThemeStructure();
  const segmented = sliderTrack === "segmented";

  return (
    <BaseSlider.Root
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      className={cn("relative w-full touch-none select-none", className)}
      {...props}
    >
      <BaseSlider.Control className="flex w-full items-center py-2">
        {/* A theme may give sliders their own fill color; otherwise they take the accent.
            Segmented tracks cut the same bar into cells with a mask, so the fill lights cell
            by cell without either element changing shape. */}
        <BaseSlider.Track
          className={cn(
            "relative h-(--slider-track-height) w-full rounded-(--slider-track-radius) bg-(--slider-track-bg)",
            segmented && "slider-segmented"
          )}
        >
          <BaseSlider.Indicator
            className={cn(
              "rounded-(--slider-track-radius) bg-[color:var(--color-slider-fill,var(--color-accent-cyan))] [box-shadow:var(--slider-fill-glow)]",
              segmented && "slider-segmented"
            )}
          />
          {thumbValues.map((_, i) => (
            <BaseSlider.Thumb
              key={i}
              index={i}
              getAriaValueText={getAriaValueText}
              className={cn(
                "size-(--slider-handle-size) rounded-(--slider-handle-radius) border-(length:--slider-handle-border-width) border-[color:var(--color-slider-fill,var(--color-accent-cyan))] bg-card shadow-sm outline-none",
                "transition-[transform,border-color,background-color] focus-visible:ring-2 focus-visible:ring-ring/40",
                // Feedback through scale and cursor rather than a shadow: the focus ring is
                // itself a box-shadow, so a shadow here would fight it. Base UI centers the
                // thumb with `translate`, which composes with Tailwind's separate `scale`.
                "cursor-grab hover:scale-110 data-[dragging]:scale-125 data-[dragging]:cursor-grabbing",
                "data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[disabled]:hover:scale-100"
              )}
            />
          ))}
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

export { Slider };
