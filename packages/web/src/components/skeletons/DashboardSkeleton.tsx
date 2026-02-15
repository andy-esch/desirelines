import Skeleton from "../Skeleton";

/**
 * Skeleton loading screen for the dashboard page.
 * Shows the approximate shape of: header, chart, card grid, and heatmap.
 */
export default function DashboardSkeleton() {
  return (
    <div className="px-4 md:px-6 py-6">
      {/* Header */}
      <div className="mb-3">
        <Skeleton width={220} height={28} />
        <div className="mt-2">
          <Skeleton width={300} height={14} />
        </div>
      </div>

      {/* Multi-sport chart area */}
      <div className="glass-panel mb-8 p-4">
        <Skeleton width="100%" height={280} borderRadius={8} />
      </div>

      {/* 2-col grid: weekly summary + goal progress */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="glass-panel p-4">
          <Skeleton width={140} height={16} />
          <div className="mt-3">
            <Skeleton width="100%" height={120} borderRadius={8} />
          </div>
        </div>
        <div className="glass-panel p-4">
          <Skeleton width={120} height={16} />
          <div className="mt-3">
            <Skeleton width="100%" height={120} borderRadius={8} />
          </div>
        </div>
      </div>

      {/* Heatmap area */}
      <div className="glass-panel mb-10 p-4">
        <Skeleton width={180} height={16} />
        <div className="mt-3">
          <Skeleton width="100%" height={160} borderRadius={8} />
        </div>
      </div>
    </div>
  );
}
