import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuthService } from "../../contexts/ServiceContext";
import { useToast } from "../../contexts/ToastContext";

// Module-level flag to survive component remounts during auth state transitions.
// When signInWithCustomToken fires, onAuthStateChanged can cause the router to
// remount this component. A useRef would reset on remount; a module-level flag
// persists across mounts within the same page load.
let signInStarted = false;

function AuthComplete() {
  const navigate = useNavigate();
  const authService = useAuthService();
  const { showToast } = useToast();

  useEffect(() => {
    if (signInStarted) return;
    signInStarted = true;

    let isMounted = true;

    const hash = window.location.hash; // "#token=abc123"
    const token = new URLSearchParams(hash.slice(1)).get("token");

    if (!token) {
      signInStarted = false;
      navigate({ to: "/auth/error", search: { error: "missing_token" } });
      return;
    }

    // Clear fragment from URL immediately (defense in depth — prevent token leakage)
    history.replaceState(null, "", window.location.pathname);

    authService
      .signInWithToken(token)
      .then(() => {
        if (isMounted) {
          showToast("Signed in successfully");
          navigate({ to: "/" });
        }
      })
      .catch(() => {
        if (isMounted) navigate({ to: "/auth/error", search: { error: "sign_in_failed" } });
      })
      .finally(() => {
        signInStarted = false;
      });

    return () => {
      isMounted = false;
    };
  }, [navigate, authService, showToast]);

  return (
    <div className="flex items-center justify-center grow">
      <p className="text-text-muted">Completing sign-in...</p>
    </div>
  );
}

export const Route = createFileRoute("/auth/complete")({
  component: AuthComplete,
});
