import type { ReactNode } from "react";

interface InlineAlertProps {
  variant?: "danger" | "warning" | "info";
  size?: "sm" | "default";
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
  children: ReactNode;
}

export function InlineAlert({
  variant = "danger",
  size = "default",
  onDismiss,
  onRetry,
  className = "",
  children,
}: InlineAlertProps) {
  const sizeClasses = size === "sm" ? "py-1 px-2 text-sm" : "";

  return (
    <div className={`alert alert-${variant} ${sizeClasses} ${className}`.trim()} role="alert">
      {children}
      {onDismiss && (
        <button
          type="button"
          className="btn-close btn-sm float-right"
          aria-label="Dismiss"
          onClick={onDismiss}
        />
      )}
      {onRetry && (
        <>
          <hr />
          <button className={`btn btn-outline-${variant}`} onClick={onRetry}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
