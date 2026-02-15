import { useLocation } from "react-router-dom";

/**
 * Wraps route content with a subtle CSS fade-in on route changes.
 * Uses the location key to trigger re-mount and animation replay.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div key={location.pathname} className="page-transition">
      {children}
    </div>
  );
}
