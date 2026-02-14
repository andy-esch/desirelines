import { useMemo } from "react";
import ReactSkeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { SKELETON_THEMES, SKELETON_DUAL_THEMES } from "../constants/uiColors";

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
  // Select a random neon theme once on mount (stable across re-renders)
  const theme = useMemo(() => {
    if (dualTheme != null) {
      return SKELETON_DUAL_THEMES[dualTheme % SKELETON_DUAL_THEMES.length];
    }
    const index = Math.floor(Math.random() * SKELETON_THEMES.length);
    return SKELETON_THEMES[index];
  }, [dualTheme]);

  return (
    <SkeletonTheme baseColor={theme.baseColor} highlightColor={theme.highlightColor}>
      <ReactSkeleton
        count={count}
        height={height}
        width={width}
        circle={circle}
        borderRadius={borderRadius}
        style={style}
        className={className}
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
