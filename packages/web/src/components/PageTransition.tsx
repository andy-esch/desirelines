import { useLocation } from "@tanstack/react-router";

/**
 * Wraps route content with a subtle CSS fade-in on route changes.
 * Uses the location pathname to trigger re-mount and animation replay.
 * Pathname (not href) avoids re-triggering on hash-only changes (e.g. anchor links).
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    // grow flex flex-col so the page's own grow container fills the <main> area;
    // without it, short pages leave the main background showing below the page's
    // gradient (a bare strip above the footer).
    <div key={location.pathname} className="page-transition grow flex flex-col">
      {children}
    </div>
  );
}
