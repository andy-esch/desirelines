import { useId } from "react";
import ReactSkeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

/** Skeleton loader color themes using subtle neon tints */
const SKELETON_THEMES = [
  { baseColor: "rgba(0, 255, 255, 0.12)", highlightColor: "rgba(0, 255, 255, 0.22)" }, // Cyan
  { baseColor: "rgba(255, 0, 255, 0.12)", highlightColor: "rgba(255, 0, 255, 0.22)" }, // Magenta
  { baseColor: "rgba(180, 0, 255, 0.12)", highlightColor: "rgba(180, 0, 255, 0.22)" }, // Purple
] as const;

/** Dual-color skeleton themes — base and highlight are different neon colors */
const SKELETON_DUAL_THEMES = [
  { baseColor: "rgba(0, 255, 255, 0.12)", highlightColor: "rgba(255, 0, 255, 0.22)" }, // Cyan → Magenta
  { baseColor: "rgba(0, 255, 128, 0.12)", highlightColor: "rgba(255, 200, 0, 0.22)" }, // Green → Yellow
  { baseColor: "rgba(180, 0, 255, 0.12)", highlightColor: "rgba(0, 255, 255, 0.22)" }, // Purple → Cyan
] as const;

interface SkeletonProps {
  /** Number of skeleton lines to render */
  count?: number;
  /** Height of each skeleton line (CSS value) */
  height?: number | string;
  /** Width of skeleton (CSS value) */
  width?: number | string;
  /** Whether to render as a circle */
  circle?: boolean;
  /** Border radius (CSS value) */
  borderRadius?: number | string;
  /** Additional inline styles */
  style?: React.CSSProperties;
  /** Additional CSS class */
  className?: string;
  /** Explicit dual-color theme index (0–2). When set, uses SKELETON_DUAL_THEMES instead of random single-color. */
  dualTheme?: number;
}

/**
 * Skeleton loader component for showing loading placeholders.
 *
 * Uses a dark theme that matches the app's aesthetic.
 * Wraps react-loading-skeleton with pre-configured theming.
 *
 * @example
 * // Single line skeleton
 * <Skeleton height={20} />
 *
 * // Multiple lines (e.g., for text)
 * <Skeleton count={3} height={16} />
 *
 * // Fixed width skeleton (e.g., for a card)
 * <Skeleton height={100} width={200} />
 *
 * // Circle skeleton (e.g., for avatar)
 * <Skeleton circle height={40} width={40} />
 */
export default function Skeleton({
  count = 1,
  height,
  width,
  circle = false,
  borderRadius,
  style,
  className,
  dualTheme,
}: SkeletonProps) {
  // Derive a stable theme from the component's unique ID.
  // useId() is SSR-safe, Strict Mode-safe, and pure (no module-level mutation).
  const id = useId();
  const theme = (() => {
    if (dualTheme != null) {
      return SKELETON_DUAL_THEMES[dualTheme % SKELETON_DUAL_THEMES.length] ?? SKELETON_DUAL_THEMES[0];
    }
    const hash = Array.from(id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return SKELETON_THEMES[hash % SKELETON_THEMES.length] ?? SKELETON_THEMES[0];
  })();

  return (
    <SkeletonTheme baseColor={theme.baseColor} highlightColor={theme.highlightColor}>
      <ReactSkeleton
        count={count}
        circle={circle}
        {...(height !== undefined && { height })}
        {...(width !== undefined && { width })}
        {...(borderRadius !== undefined && { borderRadius })}
        {...(style !== undefined && { style })}
        {...(className !== undefined && { className })}
      />
    </SkeletonTheme>
  );
}

/**
 * Pre-built skeleton for sparkline rows.
 * Matches the layout of SparklineRow component.
 */
export function SparklineSkeleton({ rowHeight = 36 }: { rowHeight?: number }) {
  return (
    <div className="flex gap-2 items-center">
      {/* Label placeholder */}
      <Skeleton width={70} height={14} />
      {/* Sparkline placeholder */}
      <div style={{ flex: 1 }}>
        <Skeleton height={rowHeight - 8} borderRadius={4} />
      </div>
    </div>
  );
}

/**
 * Pre-built skeleton for activity list rows.
 * Matches the layout of RecentActivitiesList rows.
 */
export function ActivityRowSkeleton() {
  return (
    <div className="flex gap-2 py-1">
      {/* Activity name */}
      <Skeleton width={140} height={14} />
      {/* Distance */}
      <Skeleton width={50} height={14} />
      {/* Duration */}
      <Skeleton width={40} height={14} />
      {/* Date */}
      <Skeleton width={45} height={14} />
    </div>
  );
}
