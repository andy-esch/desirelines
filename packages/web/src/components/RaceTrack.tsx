import type { CSSProperties } from "react";

/**
 * RaceTrack - A reusable horizontal track visualization with position markers.
 *
 * Shows one or two markers on a horizontal track, useful for:
 * - Progress toward a goal (primary marker)
 * - Comparison against a pace/target (secondary marker)
 * - Any "position on a line" visualization
 *
 * Design features:
 * - Thin horizontal track with subtle glow
 * - Vertical endcaps at 0% and 100%
 * - Primary marker (higher z-index, full opacity)
 * - Optional secondary/pace marker (lower z-index, reduced opacity)
 * - Positions are clamped to [0, 100]%
 *
 * @example
 * // Basic usage - single marker
 * <RaceTrack primaryPosition={75} />
 *
 * @example
 * // With pace marker
 * <RaceTrack
 *   primaryPosition={80}
 *   pacePosition={70}
 *   showPace={true}
 * />
 *
 * @example
 * // Custom markers and colors
 * <RaceTrack
 *   primaryPosition={50}
 *   pacePosition={60}
 *   showPace={true}
 *   primaryMarker="🚴"
 *   paceMarker="🎯"
 *   trackColor="rgb(0, 212, 255)"
 * />
 */

export interface RaceTrackProps {
  /** Position of primary marker (0-100%, will be clamped) */
  primaryPosition: number;

  /** Position of secondary/pace marker (0-100%, will be clamped) */
  pacePosition?: number;

  /** Whether to show the pace marker. Default: true if pacePosition provided */
  showPace?: boolean;

  /** Primary marker content. Default: "🐲" */
  primaryMarker?: string;

  /** Pace marker content. Default: "👻" */
  paceMarker?: string;

  /** Color for the track line and glow effect. Default: subtle gray */
  trackColor?: string;

  /** Height of the container in pixels. Default: 28 */
  height?: number;

  /** Additional CSS class name */
  className?: string;

  /** Additional inline styles */
  style?: CSSProperties;
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default function RaceTrack({
  primaryPosition,
  pacePosition,
  showPace = pacePosition !== undefined,
  primaryMarker = "🐲",
  paceMarker = "👻",
  trackColor = "rgba(150, 150, 150, 0.4)",
  height = 28,
  className,
  style,
}: RaceTrackProps) {
  // Clamp positions to valid range
  const primaryPct = clamp(primaryPosition, 0, 100);
  const pacePct = pacePosition !== undefined ? clamp(pacePosition, 0, 100) : 0;

  // Marker size scales with container height
  const markerSize = Math.max(16, height - 4);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        height,
        display: "flex",
        alignItems: "center",
        ...style,
      }}
    >
      {/* Track line with endcaps */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          height: 2,
          backgroundColor: trackColor,
          boxShadow: `0 0 4px ${trackColor}`,
        }}
      >
        {/* Left endcap */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: -4,
            width: 2,
            height: 10,
            backgroundColor: trackColor,
          }}
        />
        {/* Right endcap */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: -4,
            width: 2,
            height: 10,
            backgroundColor: trackColor,
          }}
        />
      </div>

      {/* Pace marker (ghost) - lower z-index, behind primary */}
      {showPace && (
        <div
          style={{
            position: "absolute",
            left: `${pacePct}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: markerSize,
            lineHeight: 1,
            opacity: 0.5,
            zIndex: 1,
            filter: "grayscale(20%)",
            transition: "left 0.3s ease-out",
          }}
          title={`Goal pace: ${pacePct.toFixed(0)}%`}
        >
          {paceMarker}
        </div>
      )}

      {/* Primary marker (dragon) - higher z-index, on top */}
      <div
        style={{
          position: "absolute",
          left: `${primaryPct}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: markerSize,
          lineHeight: 1,
          zIndex: 2,
          transition: "left 0.3s ease-out",
        }}
        title={`You: ${primaryPct.toFixed(0)}%`}
      >
        {primaryMarker}
      </div>
    </div>
  );
}

/**
 * RaceTrackLegend - Companion legend component for RaceTrack
 *
 * Shows the meaning of the markers used in the RaceTrack visualization.
 */
export interface RaceTrackLegendProps {
  /** Primary marker content. Default: "🐲" */
  primaryMarker?: string;

  /** Pace marker content. Default: "👻" */
  paceMarker?: string;

  /** Label for primary marker. Default: "You" */
  primaryLabel?: string;

  /** Label for pace marker. Default: "Pace" */
  paceLabel?: string;

  /** Whether to show the pace legend item. Default: true */
  showPace?: boolean;

  /** Additional CSS class name */
  className?: string;
}

export function RaceTrackLegend({
  primaryMarker = "🐲",
  paceMarker = "👻",
  primaryLabel = "You",
  paceLabel = "Pace",
  showPace = true,
  className,
}: RaceTrackLegendProps) {
  return (
    <div className={`d-flex gap-3 ${className ?? ""}`}>
      <span className="d-flex align-items-center gap-1">
        <span style={{ fontSize: "0.9rem" }}>{primaryMarker}</span>
        <small className="text-muted">{primaryLabel}</small>
      </span>
      {showPace && (
        <span className="d-flex align-items-center gap-1">
          <span style={{ fontSize: "0.9rem", opacity: 0.5 }}>{paceMarker}</span>
          <small className="text-muted">{paceLabel}</small>
        </span>
      )}
    </div>
  );
}
