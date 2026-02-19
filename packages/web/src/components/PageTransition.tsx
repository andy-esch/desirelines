import { useLocation } from "@tanstack/react-router";

/**
 * Wraps route content with a subtle CSS fade-in on route changes.
 * Uses the location href to trigger re-mount and animation replay.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div key={location.href} className="page-transition">
      {children}
    </div>
  );
}
