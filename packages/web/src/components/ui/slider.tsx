import * as React from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";

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
        <BaseSlider.Track className="relative h-1.5 w-full rounded-full bg-muted">
          <BaseSlider.Indicator className="rounded-full bg-primary" />
          {thumbValues.map((_, i) => (
            <BaseSlider.Thumb
              key={i}
              index={i}
              getAriaValueText={getAriaValueText}
              className={cn(
                "size-4 rounded-full border border-primary bg-card shadow-sm outline-none",
                "transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                "data-[dragging]:border-primary data-[disabled]:opacity-50"
              )}
            />
          ))}
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

export { Slider };
