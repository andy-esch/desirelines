import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { CloseIcon } from "./icons";
import { Alert } from "./ui/alert";
import { cn } from "@/lib/utils";

interface InlineAlertProps {
  variant?: "danger" | "warning" | "info" | undefined;
  size?: "sm" | "default" | undefined;
  onDismiss?: (() => void) | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * A message about something the user just did, such as a save that failed or a goal that
 * doesn't validate: shown inline, announced, and dismissible when `onDismiss` is given.
 * Something that failed to load is an `ErrorState` instead.
 */
export function InlineAlert({
  variant = "danger",
  size = "default",
  onDismiss,
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
    </Alert>
  );
}
