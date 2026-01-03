import type { ReactNode } from "react";

interface SettingRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  /** If true, value is read-only (no edit control) */
  readOnly?: boolean;
}

/**
 * Individual setting row with label, optional description, and control.
 * Use for toggle switches, dropdowns, text inputs, etc.
 */
export function SettingRow({ label, description, children, readOnly }: SettingRowProps) {
  return (
    <div
      className="d-flex justify-content-between align-items-start py-3"
      style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}
    >
      <div className="me-3" style={{ flex: 1 }}>
        <div className="fw-medium">{label}</div>
        {description && (
          <div className="text-muted small mt-1">{description}</div>
        )}
      </div>
      <div
        className="d-flex align-items-center"
        style={{ minWidth: readOnly ? "auto" : "200px", justifyContent: "flex-end" }}
      >
        {children}
      </div>
    </div>
  );
}
