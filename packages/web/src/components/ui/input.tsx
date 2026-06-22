import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input — shadcn-style text input, themed via the `@theme` shim. A plain native
 * `<input>` (pass `ref` directly, React 19); use Base UI's Field for validation
 * wiring where needed.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  ref?: React.Ref<HTMLInputElement>;
}

function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm",
        "placeholder:text-muted-foreground",
        "transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  );
}

export { Input };
