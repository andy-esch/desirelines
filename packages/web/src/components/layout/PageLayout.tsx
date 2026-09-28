import type { ReactNode } from "react";

interface PageLayoutProps {
  /** Page content */
  children: ReactNode;
}

/**
 * Full-width page layout: a flex-grow container over the theme's page ground.
 */
export function PageLayout({ children }: PageLayoutProps) {
  return <div className="grow overflow-x-hidden">{children}</div>;
}

interface NarrowPageLayoutProps {
  /** Maximum width (defaults to 800px) */
  maxWidth?: string;
  /** Page content */
  children: ReactNode;
}

/**
 * Narrow centered page layout over the theme's page ground.
 * Used for settings, forms, and focused content pages.
 */
export function NarrowPageLayout({ maxWidth = "800px", children }: NarrowPageLayoutProps) {
  return (
    <div className="grow overflow-x-hidden">
      {/* Tailwind's `container` carries no side padding of its own, so the gutter has to
          be set here or the content sits against the screen edge on a phone. */}
      <div className="container mx-auto px-4 md:px-6 py-6" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}
