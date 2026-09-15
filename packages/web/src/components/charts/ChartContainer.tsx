/**
 * ChartContainer - Wrapper component for chart loading/error/empty states.
 *
 * Provides consistent handling of:
 * - Loading state with spinner
 * - Error state with retry button
 * - Empty state with styled message
 * - Optional header with title and controls
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
  /**
   * Frame the chart in a theme `Panel`, which places the title and controls per the theme.
   * Without it the chart draws its own header row and the caller provides any frame.
   */
  framed?: boolean | undefined;
}

/** The "?" badge that explains a chart, next to its title. */
function InfoBadge({ text }: { text: string }) {
  return (
    <span
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
 * Header component with title and optional controls.
 * Handles both simple (no controls) and full header cases.
 */
function ChartHeader({
  title,
  controls,
  infoTooltip,
  simple = false,
}: {
  title: string;
  controls?: ReactNode | undefined;
  infoTooltip?: string | undefined;
  simple?: boolean | undefined;
}) {
  // Simple header for loading/error/empty states
  if (simple) {
    return (
      <h3 className="text-muted-text mb-6" style={{ fontSize: "1rem", fontWeight: "500" }}>
        {title}
      </h3>
    );
  }

  // Full header with optional controls and tooltip
  return (
    <div className="flex justify-between items-center mb-6">
      <div className="flex items-center gap-2">
        <h3 className="text-muted-text mb-0" style={{ fontSize: "1rem", fontWeight: "500" }}>
          {title}
        </h3>
        {infoTooltip && <InfoBadge text={infoTooltip} />}
      </div>
      {controls && <div className="flex gap-2">{controls}</div>}
    </div>
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
  framed = false,
}: ChartContainerProps) {
  const ready = !isLoading && !error && !isEmpty;

  // Framed: the Panel owns the title row, with the controls only once the chart can use them.
  if (framed) {
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

  // Loading state
  if (isLoading) {
    return (
      <div className={className}>
        {!hideHeader && <ChartHeader title={title} simple />}
        <LoadingChart />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={className}>
        {!hideHeader && <ChartHeader title={title} simple />}
        <ErrorChart error={error} onRetry={onRetry} />
      </div>
    );
  }

  // Empty state
  if (isEmpty) {
    return (
      <div className={className}>
        {!hideHeader && <ChartHeader title={title} simple />}
        <EmptyState
          sport={emptyStateConfig?.sport}
          year={emptyStateConfig?.year}
          unit={emptyStateConfig?.unit}
          message={emptyStateConfig?.message}
          suggestedYear={emptyStateConfig?.suggestedYear}
        />
      </div>
    );
  }

  // Normal state - render chart
  return (
    <div className={className}>
      {!hideHeader && (
        <ChartHeader title={title} controls={headerControls} infoTooltip={infoTooltip} />
      )}
      <ErrorBoundary
        fallbackRender={({ error }) => <ErrorChart error={error as Error} onRetry={onRetry} />}
      >
        {children}
      </ErrorBoundary>
    </div>
  );
}

export default ChartContainer;
