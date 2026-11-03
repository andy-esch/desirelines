import { useEffect, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Whether a chart should animate: true only on its first render, and never when the
 * user prefers reduced motion. Recharts re-animates lines on every prop change, so
 * charts gate `isAnimationActive` on this to animate once, at mount, rather than on
 * each goal or range change.
 *
 * Both lint-clean alternatives have tradeoffs: a ref read during render trips
 * `react-hooks/refs` (purity), and dropping the gate brings the re-animation back.
 * The set-state-in-effect cost (one extra render at mount) is acceptable here.
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
