import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { CloseIcon } from "./icons";

const RETRY_VARIANT = {
  danger: "outline-danger",
  warning: "outline-warning",
  info: "outline",
} as const;

interface InlineAlertProps {
  variant?: "danger" | "warning" | "info" | undefined;
  size?: "sm" | "default" | undefined;
  onDismiss?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  className?: string | undefined;
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="float-right h-6 w-6"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <CloseIcon />
        </Button>
      )}
      {onRetry && (
        <>
          <hr />
          <Button variant={RETRY_VARIANT[variant]} size="sm" onClick={onRetry}>
            Retry
          </Button>
        </>
      )}
    </div>
  );
}
