import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "./useThemeStructure";

export interface MeterProps {
  /** Progress from 0 to 1. Values outside the range are clamped. */
  value: number;
  /** Accessible name, e.g. "Year progress" or "Cycling goal progress". */
  label: string;
  /** Draw this many segments instead of a continuous track (e.g. 12 months, 52 weeks). */
  segments?: number | undefined;
  /** Fill color of a continuous track, e.g. a goal or sport color. Defaults to the meter token. */
  color?: string | undefined;
  /** A tick at this position from 0 to 1, e.g. where the pace says you should be today. */
  marker?: number | undefined;
  /** Loading: segments light in turn and no value is announced. */
  indeterminate?: boolean | undefined;
  className?: string | undefined;
}

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Progress drawn as segments or a continuous track. Sizes and colors come from the
 * `--meter-*` and `--track-*` slots. Whether the current segment fills partway, and
 * whether a continuous track prints its percent, come from the theme's structure.
 */
export function Meter({
  value,
  label,
  segments,
  color,
  marker,
  indeterminate = false,
  className,
}: MeterProps) {
  const { meterPartialCurrent, goalTrackStyle } = useThemeStructure();
  const v = clamp(value);
  const pct = Math.round(v * 100);
  const aria = indeterminate
    ? { role: "progressbar", "aria-label": label, "aria-busy": true as const }
    : {
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": pct,
      };

  if (segments != null && segments > 0) {
    const scaled = v * segments;
    const doneCount = Math.floor(scaled);
    const partial = scaled - doneCount;
    return (
      <div
        {...aria}
        data-meter="segmented"
        className={cn("flex items-center gap-(--meter-gap)", className)}
      >
        {Array.from({ length: segments }, (_, i) => {
          const segment =
            "h-(--meter-segment-height) w-(--meter-segment-width) rounded-(--meter-radius)";
          if (indeterminate) {
            return (
              <span
                key={i}
                data-segment="chase"
                className={cn(
                  segment,
                  "bg-(--color-meter-todo) motion-safe:animate-[meter-chase_1.2s_ease-in-out_infinite]"
                )}
                style={{ animationDelay: `${(i * 1.2) / segments}s` }}
              />
            );
          }
          if (i < doneCount) {
            return (
              <span
                key={i}
                data-segment="done"
                className={cn(
                  segment,
                  "bg-(--color-meter-done) [box-shadow:var(--meter-done-glow)]"
                )}
              />
            );
          }
          if (i === doneCount && doneCount < segments) {
            const fill = meterPartialCurrent ? `${Math.round(partial * 100)}%` : "100%";
            return (
              <span
                key={i}
                data-segment="current"
                className={cn(segment, "relative overflow-visible bg-(--color-meter-todo)")}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-(--meter-radius) bg-(--color-meter-current) [box-shadow:var(--meter-current-glow)]"
                  style={{ width: fill }}
                />
              </span>
            );
          }
          return (
            <span key={i} data-segment="todo" className={cn(segment, "bg-(--color-meter-todo)")} />
          );
        })}
      </div>
    );
  }

  const fillStyle: CSSProperties = {
    width: `${pct}%`,
    ...(color ? { backgroundColor: color } : {}),
    boxShadow: `0 0 var(--track-fill-glow) ${color ?? "var(--color-meter-done)"}`,
  };
  return (
    <div
      {...aria}
      data-meter="continuous"
      className={cn(
        "relative flex items-center min-w-24 h-(--track-height) bg-(--track-bg) [border:var(--track-border)] rounded-(--track-radius)",
        goalTrackStyle === "outline-track" && "px-px",
        className
      )}
    >
      <span
        className={cn(
          "block h-(--track-fill-height) rounded-(--track-radius)",
          !color && "bg-(--color-meter-done)"
        )}
        style={fillStyle}
      />
      {marker != null && (
        <span
          data-marker
          aria-hidden="true"
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-(--pace-tick-width) h-(--pace-tick-height) bg-(--color-pace-tick)"
          style={{ left: `${clamp(marker) * 100}%` }}
        />
      )}
      {goalTrackStyle === "bar-with-percent" && !indeterminate && (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-scrim/50 px-1.5 py-0.5 text-xs leading-none font-medium text-on-scrim">
          {pct}%
        </span>
      )}
    </div>
  );
}
