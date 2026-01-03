import type { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Reusable section wrapper for settings page.
 * Provides consistent styling for grouped settings.
 */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className="card mb-4">
      <div className="card-header">
        <h5 className="mb-0" style={{ color: "var(--slate-dark, #2d3748)" }}>
          {title}
        </h5>
        {description && <p className="text-muted small mb-0 mt-1">{description}</p>}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}
