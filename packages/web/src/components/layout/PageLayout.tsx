import type { ReactNode } from "react";
import type { PageBackgroundKey } from "../../styles/pageBackgrounds";
import { pageBackgrounds } from "../../styles/pageBackgrounds";

interface PageLayoutProps {
  /** Page background gradient key */
  background: PageBackgroundKey;
  /** Page content */
  children: ReactNode;
}

/**
 * Full-width page layout with gradient background.
 * Wraps content in a flex-grow container with the page's background gradient.
 *
 * @example
 * ```tsx
 * <PageLayout background="dashboard">
 *   <div className="container-fluid py-4">...</div>
 * </PageLayout>
 * ```
 */
export function PageLayout({ background, children }: PageLayoutProps) {
  return (
    <div className="flex-grow-1" style={{ background: pageBackgrounds[background] }}>
      {children}
    </div>
  );
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
 *
 * @example
 * ```tsx
 * <NarrowPageLayout background="settings">
 *   <h1>Settings</h1>
 *   ...
 * </NarrowPageLayout>
 * ```
 */
export function NarrowPageLayout({
  background,
  maxWidth = "800px",
  children,
}: NarrowPageLayoutProps) {
  return (
    <div className="flex-grow-1" style={{ background: pageBackgrounds[background] }}>
      <div className="container py-4" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}
