import type { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Optional id for anchor link support */
  id?: string;
}

/**
 * Reusable section wrapper for settings page.
 * Provides consistent styling for grouped settings.
 */
export function SettingsSection({ title, description, children, id }: SettingsSectionProps) {
  return (
    <div className="card mb-6" id={id}>
      <div className="card-header">
        <h5 className="mb-0" style={{ color: "var(--color-slate-dark)" }}>
          {title}
        </h5>
        {description && <p className="text-slate-light text-sm mb-0 mt-1">{description}</p>}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}
