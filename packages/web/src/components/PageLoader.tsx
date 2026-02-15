import Skeleton from "./Skeleton";

/**
 * Full-page loading state for lazy-loaded routes.
 * Used as a Suspense fallback during code-split chunk loading.
 * Shows a generic page skeleton that approximates common page layouts.
 */
export default function PageLoader() {
  return (
    <div className="px-4 md:px-6 py-6 grow" style={{ minHeight: "50vh" }}>
      {/* Title placeholder */}
      <div className="mb-4">
        <Skeleton width={200} height={28} />
      </div>

      {/* Content area placeholders */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass-panel-kpi p-4">
            <Skeleton width={80} height={12} />
            <div className="mt-2">
              <Skeleton width={120} height={32} />
            </div>
          </div>
        ))}
      </div>

      <div className="glass-panel p-4">
        <Skeleton width="100%" height={300} borderRadius={8} />
      </div>
    </div>
  );
}
