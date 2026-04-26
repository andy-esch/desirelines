import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../../hooks/useAuth";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You declined access to your Strava account.",
  invalid_state: "The sign-in link expired. Please try again.",
  missing_code: "Something went wrong during sign-in. Please try again.",
  exchange_failed: "Couldn't connect to Strava. Please try again later.",
  insufficient_scope:
    "Desirelines needs permission to read your activities. Please try again and grant access.",
  not_invited: "Your Strava account hasn't been invited yet.",
  server_error: "Something went wrong on our end. Please try again later.",
  missing_token: "Sign-in incomplete. Please try again.",
  sign_in_failed: "Couldn't complete sign-in. Please try again.",
};

function AuthError() {
  const { error: errorCode } = Route.useSearch();
  const { signIn } = useAuth();

  const message = ERROR_MESSAGES[errorCode ?? ""] ?? "An unknown error occurred. Please try again.";

  return (
    <div className="flex items-center justify-center grow">
      <div className="glass-panel p-8 max-w-md text-center">
        <h1 className="text-xl font-semibold text-text-primary mb-4">Sign-In Error</h1>
        <p className="text-text-muted mb-6">{message}</p>
        <button onClick={() => void signIn()} className="btn btn-sm btn-primary">
          Try Again
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/auth/error")({
  component: AuthError,
  validateSearch: (search: Record<string, unknown>): { error?: string | undefined } => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
});
