import { useEffect, useRef, useState } from "react";

/**
 * Returns a throttled view of `value` that updates at most once per `ms`
 * (leading + trailing edge). Used to rate-limit the routes-map `setFilter` edge
 * while a slider is dragged continuously: the cross-filter data model (KPIs,
 * summary, list) updates synchronously off the raw filter state, but the Mapbox
 * layer — where re-applying a filter is the expensive operation — only sees the
 * throttled value, so a drag doesn't recompile the filter every frame.
 *
 * (See the routes-map design-spec review addendum: prefer throttling the map
 * edge over throttling the whole filter state, so the panel stays live.)
 */
export function useThrottledValue<T>(value: T, ms = 120): T {
  const [throttled, setThrottled] = useState(value);
  const lastEmitRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hold the freshest value so a trailing emit publishes the latest, not a stale
  // one. Written in the effect (not during render) so it stays render-pure.
  const latestRef = useRef(value);

  useEffect(() => {
    latestRef.current = value;
    const elapsed = Date.now() - lastEmitRef.current;
    if (elapsed >= ms) {
      // Leading edge (or enough time has passed): publish immediately.
      lastEmitRef.current = Date.now();
      setThrottled(value);
    } else {
      // Within the window: schedule a single trailing emit of the latest value.
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        lastEmitRef.current = Date.now();
        setThrottled(latestRef.current);
      }, ms - elapsed);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, ms]);

  return throttled;
}
