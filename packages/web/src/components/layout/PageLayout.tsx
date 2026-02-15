import type { ReactNode } from "react";

/** Page background keys matching @utility page-bg-* classes in tailwind.css */
export type PageBackgroundKey = "dashboard" | "activities" | "sport" | "origins" | "settings";

const bgClasses: Record<PageBackgroundKey, string> = {
  dashboard: "page-bg-dashboard",
  activities: "page-bg-activities",
  sport: "page-bg-sport",
  origins: "page-bg-origins",
  settings: "page-bg-settings",
};

interface PageLayoutProps {
  /** Page background gradient key */
  background: PageBackgroundKey;
  /** Page content */
  children: ReactNode;
}

/**
 * Full-width page layout with gradient background.
 * Wraps content in a flex-grow container with the page's background gradient.
 */
export function PageLayout({ background, children }: PageLayoutProps) {
  return <div className={`grow ${bgClasses[background]}`}>{children}</div>;
}

interface NarrowPageLayoutProps {
  /** Page background gradient key */
  background: PageBackgroundKey;
  /** Maximum width (defaults to 800px) */
  maxWidth?: string;
  /** Page content */
  children: ReactNode;
}

/**
 * Narrow centered page layout with gradient background.
 * Used for settings, forms, and focused content pages.
 */
export function NarrowPageLayout({
  background,
  maxWidth = "800px",
  children,
}: NarrowPageLayoutProps) {
  return (
    <div className={`grow ${bgClasses[background]}`}>
      <div className="container py-6" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}
