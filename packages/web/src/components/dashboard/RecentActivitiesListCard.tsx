import { type TimeRange } from "../../utils/dataNormalization";
import RecentActivitiesList from "./RecentActivitiesList";

interface RecentActivitiesListCardProps {
  timeRange: TimeRange;
  className?: string;
  pageSize?: number;
}

/**
 * Card wrapper for RecentActivitiesList.
 * Provides the glass-panel styling and consistent spacing.
 */
export default function RecentActivitiesListCard({
  timeRange,
  className = "",
  pageSize = 5,
}: RecentActivitiesListCardProps) {
  return (
    <div className={`glass-panel h-full overflow-hidden flex flex-col ${className}`}>
      <RecentActivitiesList timeRange={timeRange} pageSize={pageSize} />
    </div>
  );
}
