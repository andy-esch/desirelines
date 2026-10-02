import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { useHeadingLevel, type HeadingLevel } from "./theme/useHeadingLevel";

interface ErrorStateProps {
  /** What failed, e.g. "Error loading activities". */
  title: ReactNode;
  /** The detail under the title, usually the error's message. */
  children?: ReactNode;
  /** Offers the shared Retry button. */
  onRetry?: (() => void) | undefined;
  /** Other ways out, after Retry (e.g. a link back to the dashboard). */
  actions?: ReactNode;
  /** The title's heading level: the outline's own unless the error stands in for a page. */
  level?: 1 | HeadingLevel | undefined;
  className?: string | undefined;
}

/**
 * Something that failed to load, the same in every theme: a title in the danger color, the
 * detail under it, and a Retry outline button where trying again can help. The title takes
 * the theme's `--error-title-*` slots (Arcade's is tracked uppercase with a glow) and keeps
 * the body face. Announced as an alert. Inside a panel, give the panel `tone="danger"` so the
 * theme can frame the error.
 *
 * @example
 * <ErrorState title="Error loading activities" onRetry={retry}>{error.message}</ErrorState>
 */
export function ErrorState({
  title,
  children,
  onRetry,
  actions,
  level,
  className,
}: ErrorStateProps) {
  const outlineLevel = useHeadingLevel();
  const Title = `h${level ?? outlineLevel}` as const;
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 text-sm", className)}>
      <Title className="m-0 [font-family:inherit] text-sm text-danger font-(weight:--error-title-weight) tracking-(--error-title-tracking) [text-transform:var(--error-title-case)] [text-shadow:var(--error-title-shadow)]">
        {title}
      </Title>
      {children != null && <div className="text-subtle-text break-words">{children}</div>}
      {(onRetry != null || actions != null) && (
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button variant="outline-danger" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}

export default ErrorState;
