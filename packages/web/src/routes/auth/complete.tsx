import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuthService } from "../../contexts/ServiceContext";

function AuthComplete() {
  const navigate = useNavigate();
  const authService = useAuthService();
  const hasRun = useRef(false);

  useEffect(() => {
    // Prevent double-execution in StrictMode
    if (hasRun.current) return;
    hasRun.current = true;

    let isMounted = true;

    const hash = window.location.hash; // "#token=abc123"
    const token = new URLSearchParams(hash.slice(1)).get("token");

    if (!token) {
      navigate({ to: "/auth/error", search: { error: "missing_token" } });
      return;
    }

    // Clear fragment from URL immediately (defense in depth — prevent token leakage)
    history.replaceState(null, "", window.location.pathname);

    authService
      .signInWithToken(token)
      .then(() => {
        if (isMounted) navigate({ to: "/" });
      })
      .catch(() => {
        if (isMounted) navigate({ to: "/auth/error", search: { error: "sign_in_failed" } });
      });

    return () => {
      isMounted = false;
    };
  }, [navigate, authService]);

  return (
    <div className="flex items-center justify-center grow">
      <p className="text-text-muted">Completing sign-in...</p>
    </div>
  );
}

export const Route = createFileRoute("/auth/complete")({
  component: AuthComplete,
});
