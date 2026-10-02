/**
 * ChartContainer - Wrapper component for chart loading/error/empty states.
 *
 * Provides consistent handling of:
 * - Loading state with the theme's loader
 * - Error state with retry button
 * - Empty state with the shared "No signal" headline
 * - A theme Panel holding the title and controls, which the theme places
 */
import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import type { MetricUnit } from "../../utils/units";
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import EmptyState from "../EmptyState";
import { Panel } from "../theme/Panel";

/** Configuration for the empty state display */
interface EmptyStateConfig {
  sport?: string | undefined;
  year?: number | undefined;
  unit?: MetricUnit | undefined;
  message?: string | undefined;
  suggestedYear?: number | undefined;
}

interface ChartContainerProps {
  /** Chart title displayed in header */
  title: string;
  /** Whether data is currently loading */
  isLoading: boolean;
  /** Error object if data fetch failed */
  error: Error | null;
  /** Whether the data array is empty */
  isEmpty: boolean;
  /** Hide the header section (title + controls) */
  hideHeader?: boolean | undefined;
  /** Callback to retry loading data */
  onRetry?: (() => void) | undefined;
  /** Optional controls to render in the header (e.g., view toggle buttons) */
  headerControls?: ReactNode | undefined;
  /** Additional class name for the container */
  className?: string | undefined;
  /** Chart content to render when data is ready */
  children: ReactNode;
  /** Configuration for empty state (sport, year, unit, message, suggestedYear) */
  emptyStateConfig?: EmptyStateConfig | undefined;
  /** Optional info tooltip content shown next to title */
  infoTooltip?: string | undefined;
}

/**
 * The "?" badge that explains a chart, next to its title. Its explanation is a hover title
 * only, so the glyph stays out of the accessibility tree rather than reading as part of a
 * heading ("Cumulative Distance ?").
 */
function InfoBadge({ text }: { text: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        cursor: "help",
        color: "var(--color-muted-text)",
        fontSize: "12px",
        borderRadius: "50%",
        width: "16px",
        height: "16px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--color-muted-text)",
        letterSpacing: "normal",
      }}
      title={text}
    >
      ?
    </span>
  );
}

/**
 * ChartContainer component - wraps chart content with consistent state handling.
 *
 * Usage:
 * ```tsx
 * <ChartContainer
 *   title="Cumulative Distance"
 *   isLoading={isLoading}
 *   error={error}
 *   isEmpty={distanceData.length === 0}
 *   emptyStateConfig={{ sport, year, unit, message: "No data" }}
 *   headerControls={<ViewToggle />}
 * >
 *   <ResponsiveContainer>
 *     <LineChart data={mergedData}>...</LineChart>
 *   </ResponsiveContainer>
 * </ChartContainer>
 * ```
 */
export function ChartContainer({
  title,
  isLoading,
  error,
  isEmpty,
  hideHeader = false,
  onRetry,
  headerControls,
  className = "",
  children,
  emptyStateConfig,
  infoTooltip,
}: ChartContainerProps) {
  const ready = !isLoading && !error && !isEmpty;

  // The Panel owns the title row, with the controls only once the chart can use them.
  const panelTitle = hideHeader ? undefined : (
    <span className="inline-flex items-center gap-2">
      {title}
      {ready && infoTooltip && <InfoBadge text={infoTooltip} />}
    </span>
  );
  return (
    <Panel
      title={panelTitle}
      actions={ready && !hideHeader ? headerControls : undefined}
      tone={!isLoading && error ? "danger" : undefined}
      className={className}
      bodyClassName="p-2"
    >
      {isLoading ? (
        <LoadingChart />
      ) : error ? (
        <ErrorChart error={error} onRetry={onRetry} />
      ) : isEmpty ? (
        <EmptyState
          sport={emptyStateConfig?.sport}
          year={emptyStateConfig?.year}
          unit={emptyStateConfig?.unit}
          message={emptyStateConfig?.message}
          suggestedYear={emptyStateConfig?.suggestedYear}
        />
      ) : (
        <ErrorBoundary
          fallbackRender={({ error }) => <ErrorChart error={error as Error} onRetry={onRetry} />}
        >
          {children}
        </ErrorBoundary>
      )}
    </Panel>
  );
}

export default ChartContainer;
