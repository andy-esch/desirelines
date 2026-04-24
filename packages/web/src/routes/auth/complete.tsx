import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuthService } from "../../contexts/ServiceContext";
import { useToast } from "../../contexts/ToastContext";

// Module-level flag to survive component remounts during React StrictMode
// double-mounting in development. Prevents duplicate signInWithToken calls.
let signInStarted = false;

function AuthComplete() {
  const navigate = useNavigate();
  const authService = useAuthService();
  const { showToast } = useToast();

  useEffect(() => {
    if (signInStarted) return;
    signInStarted = true;

    const hash = window.location.hash; // "#token=abc123"
    const token = new URLSearchParams(hash.slice(1)).get("token");

    if (!token) {
      signInStarted = false;
      void navigate({ to: "/auth/error", search: { error: "missing_token" } });
      return;
    }

    // Clear fragment from URL immediately (defense in depth — prevent token leakage)
    history.replaceState(null, "", window.location.pathname);

    void authService
      .signInWithToken(token)
      .then(() => {
        showToast("Signed in successfully");
        void navigate({ to: "/" });
      })
      .catch(() => {
        void navigate({ to: "/auth/error", search: { error: "sign_in_failed" } });
      })
      .finally(() => {
        signInStarted = false;
      });

    // No isMounted cleanup needed — navigate() and showToast() are
    // context/router operations that are safe to call after unmount.
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
