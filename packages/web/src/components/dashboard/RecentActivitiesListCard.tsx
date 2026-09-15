import { type TimeRange } from "../../utils/dataNormalization";
import RecentActivitiesList from "./RecentActivitiesList";
import { Panel } from "../theme/Panel";
import { cn } from "@/lib/utils";

interface RecentActivitiesListCardProps {
  timeRange: TimeRange;
  className?: string;
  pageSize?: number;
}

/**
 * Card wrapper for RecentActivitiesList.
 * Frames the list in a theme `Panel`.
 */
export default function RecentActivitiesListCard({
  timeRange,
  className = "",
  pageSize = 5,
}: RecentActivitiesListCardProps) {
  return (
    <Panel
      className={cn("h-full overflow-hidden", className)}
      bodyClassName="flex min-h-0 flex-1 flex-col p-2"
    >
      <RecentActivitiesList timeRange={timeRange} pageSize={pageSize} />
    </Panel>
  );
}
