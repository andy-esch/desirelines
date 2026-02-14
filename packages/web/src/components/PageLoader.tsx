import NeonSpinner from "./NeonSpinner";

/**
 * Full-page loading state for lazy-loaded routes.
 * Used as a Suspense fallback during code-split chunk loading.
 */
export default function PageLoader() {
  return (
    <div className="flex justify-center items-center grow" style={{ minHeight: "50vh" }}>
      <NeonSpinner />
    </div>
  );
}
