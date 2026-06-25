import NeonSpinner from "../NeonSpinner";

/**
 * Shared loading state for the routes map, used in two phases:
 *  - `RoutesPage` Suspense fallback while the lazy map chunk downloads, and
 *  - the in-map overlay shown from mount until Mapbox fires `load`.
 *
 * Its own module (not exported from `RouteMap`) so the Suspense fallback doesn't
 * drag `mapbox-gl` into the main bundle. `NeonSpinner` already carries the
 * `role="status"` live region, so the wrapper deliberately omits one to avoid a
 * duplicate screen-reader announcement.
 */
export default function MapLoadingState() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center bg-bg-body/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <NeonSpinner />
        <span className="text-sm text-slate-light">Loading map…</span>
      </div>
    </div>
  );
}
