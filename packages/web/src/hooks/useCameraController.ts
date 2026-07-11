import { useCallback, useEffect, useRef, useState } from "react";
import type { RegionSummary } from "../api/map";

/**
 * The single camera command the routes map executes. One is issued for every
 * framing — deep-linked activity, list-row, region select, and the default region
 * on load — so all precedence lives in one place (this hook), and RouteMap is a
 * pure executor. `nonce` changes per request so re-issuing the same target re-fits;
 * `duration` is the ease time in ms (0 = instant load-time frame, 600 = gesture ease).
 */
export interface FitRequest {
  bbox: [number, number, number, number];
  nonce: number;
  duration: number;
}

export interface UseCameraControllerArgs {
  /** Densest region for the session; framed when it resolves unless a target is active. */
  defaultViewport: RegionSummary | null;
  /** True while a specific activity or region is selected — it owns the camera. */
  hasExplicitTarget: boolean;
}

export interface CameraController {
  /** The command to hand the map (null = nothing to frame yet). */
  fitTo: FitRequest | null;
  /** Frame a bbox from any gesture. `duration` defaults to an eased 600ms; a
   *  no-op if `bbox` is absent or not a 4-tuple. */
  requestFit: (bbox?: number[], duration?: number) => void;
}

/**
 * Owns the routes-map camera as a single source of truth. Every framing flows
 * through `requestFit`, so the map has no competing fit sources. The default-region
 * fit is gated on `hasExplicitTarget` HERE (rather than suppressed downstream),
 * which makes precedence race-proof: a late-resolving region simply isn't issued as
 * a fit while a target is selected, and there's no persistent suppression to get
 * stuck. See RouteMap's "Camera control" note for the executor side.
 */
export function useCameraController({
  defaultViewport,
  hasExplicitTarget,
}: UseCameraControllerArgs): CameraController {
  const [fitTo, setFitTo] = useState<FitRequest | null>(null);
  const nonceRef = useRef(0);

  const requestFit = useCallback((bbox?: number[], duration = 600) => {
    if (bbox && bbox.length === 4) {
      setFitTo({
        bbox: bbox as [number, number, number, number],
        nonce: ++nonceRef.current,
        duration,
      });
    }
  }, []);

  // Frame the default (densest) region when it first resolves or genuinely changes,
  // unless an explicit target already owns the camera. Seeded from the mount region
  // since the map's `initialViewState` already frames that one (no double-fit).
  const fittedDefaultRef = useRef<number | null>(defaultViewport?.regionId ?? null);
  useEffect(() => {
    if (!defaultViewport) return;
    if (fittedDefaultRef.current === defaultViewport.regionId) return;
    // Mark handled even when skipping the fit, so a later target-clear doesn't snap
    // the camera to a region we intentionally didn't frame.
    fittedDefaultRef.current = defaultViewport.regionId;
    if (hasExplicitTarget) return;
    requestFit(defaultViewport.bbox, 0);
  }, [defaultViewport, hasExplicitTarget, requestFit]);

  return { fitTo, requestFit };
}
