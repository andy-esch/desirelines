import Skeleton from "../Skeleton";

/**
 * Skeleton loading screen for sport detail pages.
 * Shows the approximate shape of: title, KPI cards, goal table, and chart areas.
 */
export default function SportPageSkeleton() {
  return (
    <div className="px-4 md:px-6 py-6">
      {/* Title */}
      <div className="pt-6 pb-2 mb-3">
        <Skeleton width={200} height={28} />
      </div>

      {/* KPI Cards — 3 across */}
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

      {/* Goal table placeholder */}
      <div className="mb-6">
        <Skeleton width="100%" height={80} borderRadius={10} />
      </div>

      {/* Chart area 1 */}
      <div className="glass-panel mb-10 p-4">
        <div className="flex justify-between items-center mb-4">
          <Skeleton width={160} height={16} />
          <Skeleton width={200} height={28} />
        </div>
        <Skeleton width="100%" height={300} borderRadius={8} />
      </div>

      {/* Chart area 2 */}
      <div className="glass-panel mb-12 p-4">
        <div className="mb-4">
          <Skeleton width={180} height={16} />
        </div>
        <Skeleton width="100%" height={300} borderRadius={8} />
      </div>
    </div>
  );
}
