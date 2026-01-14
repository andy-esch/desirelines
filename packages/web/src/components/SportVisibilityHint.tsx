import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

interface SportVisibilityHintProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Passive hint to help users discover the sport visibility settings.
 * Shown below sport dropdowns to guide users who can't find a sport.
 */
export function SportVisibilityHint({ className = "", style }: SportVisibilityHintProps) {
  return (
    <div className={`text-muted ${className}`} style={{ fontSize: "0.7rem", ...style }}>
      Don't see your sport? <Link to="/settings#sport-visibility">Manage visible sports</Link>
    </div>
  );
}

export default SportVisibilityHint;
