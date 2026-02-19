import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";

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
    <div className={`text-slate-light ${className}`} style={{ fontSize: "0.7rem", ...style }}>
      Don't see your sport?{" "}
      <Link to="/settings" hash="sport-visibility">
        Manage visible sports
      </Link>
    </div>
  );
}

export default SportVisibilityHint;
