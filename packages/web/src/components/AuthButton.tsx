import { useAuth } from "../hooks/useAuth";

/**
 * Authentication button component
 * Shows "Sign In" for anonymous users, "Sign Out" for authenticated users
 */
export default function AuthButton() {
  const { user, loading, signIn, signOut } = useAuth();

  // Don't show anything while loading
  if (loading) {
    return null;
  }

  // Show sign out button for authenticated users
  if (user) {
    return (
      <button
        onClick={signOut}
        className="btn btn-sm btn-outline-light"
        title={`Signed in as ${user.email}`}
      >
        Sign Out
      </button>
    );
  }

  // Show sign in button for anonymous users
  return (
    <button
      onClick={signIn}
      className="btn btn-sm btn-primary"
    >
      Sign In
    </button>
  );
}
