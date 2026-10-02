import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui/button";
import { InlineAlert } from "./InlineAlert";

/**
 * Authentication button component
 * Shows "Connect with Strava" for anonymous users, "Sign Out" for authenticated users
 */
export default function AuthButton() {
  const { user, loading, error, signIn, signOut } = useAuth();
  const [actionLoading, setActionLoading] = useState(false);

  // Don't show anything while loading
  if (loading) {
    return null;
  }

  const handleSignIn = async () => {
    setActionLoading(true);
    try {
      await signIn();
    } catch {
      // Error is already set in useAuth state
    } finally {
      setActionLoading(false);
    }
  };

  const handleSignOut = async () => {
    setActionLoading(true);
    try {
      await signOut();
    } catch {
      // Error is already set in useAuth state
    } finally {
      setActionLoading(false);
    }
  };

  // Show sign out button for authenticated users
  if (user) {
    return (
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleSignOut()}
          disabled={actionLoading}
        >
          {actionLoading ? "Signing out…" : "Sign Out"}
        </Button>
        {error && (
          <InlineAlert size="sm" className="mt-1">
            {error.message}
          </InlineAlert>
        )}
      </div>
    );
  }

  // Show Strava connect button for anonymous users
  return (
    <div>
      <Button size="sm" onClick={() => void handleSignIn()} disabled={actionLoading}>
        {actionLoading ? "Connecting…" : "Connect with Strava"}
      </Button>
      {error && (
        <InlineAlert size="sm" className="mt-1">
          {error.message}
        </InlineAlert>
      )}
    </div>
  );
}
