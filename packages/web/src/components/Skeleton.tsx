import type { CSSProperties, ReactNode } from "react";
import ReactSkeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

/**
 * The shimmer fades in from transparent rather than from the block's color: the block is
 * translucent, so a sweep that started from it would paint it twice and trail a band.
 */
const SHIMMER =
  "linear-gradient(90deg, transparent 0%, var(--color-skeleton-shimmer) 50%, transparent 100%)";

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
}

/**
 * Skeleton loader component for showing loading placeholders.
 *
 * Blocks take the theme's `--color-skeleton`, a faint tint of its text that shows on dark
 * and white grounds alike, and a shimmer in `--color-skeleton-shimmer` sweeps across them.
 * The sweep stops under reduced motion. Wraps react-loading-skeleton.
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
}: SkeletonProps) {
  return (
    <SkeletonTheme baseColor="var(--color-skeleton)" customHighlightBackground={SHIMMER}>
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
 * Skeleton blocks standing in for content that's loading: a status region that says
 * "Loading…" to screen readers, since the blocks themselves say nothing. `label` names the
 * region when a page has several (e.g. "Loading weekly summary").
 */
export function SkeletonRegion({
  label,
  className,
  style,
  children,
}: {
  label?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className={className} style={style}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
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
      <div className="flex-1">
        <Skeleton height={rowHeight - 8} borderRadius={4} />
      </div>
    </div>
  );
}
