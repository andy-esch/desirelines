import { useId, type ReactNode } from "react";

interface SettingRowProps {
  label: string;
  description?: string;
  /** Pass a render function to receive the descriptionId for aria-describedby */
  children: ReactNode | ((descriptionId?: string) => ReactNode);
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
  const descriptionId = description && !readOnly ? `${id}-desc` : undefined;

  return (
    <div
      className="flex justify-between items-start py-6"
      style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}
    >
      <div className="me-6" style={{ flex: 1 }}>
        <div className="font-medium">{label}</div>
        {description && (
          <div id={descriptionId} className="text-slate-light text-sm mt-1">
            {description}
          </div>
        )}
      </div>
      <div
        className="flex items-center"
        style={{ minWidth: readOnly ? "auto" : "200px", justifyContent: "flex-end" }}
      >
        {typeof children === "function" ? children(descriptionId) : children}
      </div>
    </div>
  );
}
