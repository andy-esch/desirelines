import { useId, type ReactNode } from "react";
import { cn } from "../../lib/utils";

interface SettingRowProps {
  label: string;
  description?: string;
  /** Pass a render function to receive the descriptionId for aria-describedby */
  children: ReactNode | ((descriptionId?: string, inputId?: string) => ReactNode);
  /** If true, value is read-only (no edit control) */
  readOnly?: boolean;
}

/**
 * Individual setting row with label, optional description, and control.
 * Use for toggle switches, dropdowns, text inputs, etc.
 *
 * When a description is provided and the row is not read-only, the description
 * element gets an id so form controls can reference it via aria-describedby.
 * Pass the descriptionId to children via the `aria-describedby` attribute.
 */
export function SettingRow({ label, description, children, readOnly }: SettingRowProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const descriptionId = description && !readOnly ? `${id}-desc` : undefined;
  const LabelTag = readOnly ? "div" : "label";

  return (
    <div
      className="flex flex-col gap-3 py-6 sm:flex-row sm:items-start sm:justify-between sm:gap-0"
      style={{ borderBottom: "1px solid var(--color-surface-border)" }}
    >
      {/* Stacked on phones: a label long enough to need two lines (a timezone name, say)
          leaves the side-by-side row too narrow for its own control, and the page clips
          the overflow rather than scrolling it. */}
      <div className="sm:me-6 sm:flex-1">
        <LabelTag htmlFor={readOnly ? undefined : inputId} className="font-medium block">
          {label}
        </LabelTag>
        {description && (
          <div id={descriptionId} className="text-muted-text text-sm mt-1">
            {description}
          </div>
        )}
      </div>
      <div className={cn("flex items-center sm:justify-end", !readOnly && "sm:min-w-[200px]")}>
        {typeof children === "function" ? children(descriptionId, inputId) : children}
      </div>
    </div>
  );
}
