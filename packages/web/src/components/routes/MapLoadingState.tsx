import Loader from "../Loader";

/**
 * Shared loading state for the routes map, used in two phases:
 *  - `RoutesPage` Suspense fallback while the lazy map chunk downloads, and
 *  - the in-map overlay shown from mount until Mapbox fires `load`.
 *
 * Its own module (not exported from `RouteMap`) so the Suspense fallback doesn't
 * drag `mapbox-gl` into the main bundle. `Loader` carries the `role="status"`
 * live region and the label, so the wrapper omits both to avoid a duplicate
 * screen-reader announcement.
 */
export default function MapLoadingState() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center bg-bg-body/60 backdrop-blur-(--glass-blur-sm)">
      <Loader label="Loading map…" />
    </div>
  );
}
