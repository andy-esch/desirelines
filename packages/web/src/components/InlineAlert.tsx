import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { CloseIcon } from "./icons";
import { Alert } from "./ui/alert";
import { cn } from "@/lib/utils";

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
  return (
    <Alert
      variant={variant}
      role="alert"
      className={cn(size === "sm" && "px-2 py-1 text-sm", className)}
    >
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
    </Alert>
  );
}
