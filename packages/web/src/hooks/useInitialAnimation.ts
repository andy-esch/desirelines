import { useState, useEffect } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Returns true only on a chart's first render, and never when the OS prefers
 * reduced motion. Pass it to Recharts' `isAnimationActive` so lines animate in
 * once on mount instead of re-animating on every goal or range change.
 *
 * Both lint-clean alternatives have tradeoffs: a ref read during render trips
 * `react-hooks/refs` (purity), and dropping the gate makes Recharts re-animate
 * every prop change. The set-state-in-effect cost (one extra render at mount)
 * is acceptable here.
 */
export function useInitialAnimation(): boolean {
  const reducedMotion = useReducedMotion();
  const [isFirstRender, setIsFirstRender] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount-only gate for Recharts animation
    setIsFirstRender(false);
  }, []);
  return isFirstRender && !reducedMotion;
}
