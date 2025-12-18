import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEffect, useState } from "react";

/**
 * Landing page shown to unauthenticated users.
 * Provides options to sign in with Google or try the demo.
 * Authenticated users are redirected to /cycling.
 */
export default function LandingPage() {
  const navigate = useNavigate();
  const { user, loading, signIn, error } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  // Redirect authenticated users to the main app
  useEffect(() => {
    if (!loading && user) {
      navigate("/cycling", { replace: true });
    }
  }, [user, loading, navigate]);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signIn();
      // Navigation will happen via useEffect when user state updates
    } catch {
      // Error is handled by useAuth
    } finally {
      setSigningIn(false);
    }
  };

  const handleDemo = () => {
    navigate("/demo/cycling");
  };

  // Show loading state while checking auth
  if (loading) {
    return (
      <div
        className="container d-flex justify-content-center align-items-center"
        style={{ minHeight: "80vh" }}
      >
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  // Don't render if user is authenticated (will redirect)
  if (user) {
    return null;
  }

  return (
    <div className="container">
      <div className="row justify-content-center align-items-center" style={{ minHeight: "80vh" }}>
        <div className="col-md-6 col-lg-5">
          <div className="card shadow-sm">
            <div className="card-body p-5 text-center">
              <h1 className="h3 mb-3">Desire Lines</h1>
              <p className="text-muted mb-4">
                Track your fitness goals with beautiful visualizations. See your progress, set
                targets, and stay motivated.
              </p>

              <div className="d-grid gap-3">
                <button
                  onClick={handleSignIn}
                  className="btn btn-primary btn-lg"
                  disabled={signingIn}
                >
                  {signingIn ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Signing in...
                    </>
                  ) : (
                    "Sign in with Google"
                  )}
                </button>

                <div className="d-flex align-items-center my-2">
                  <hr className="flex-grow-1" />
                  <span className="px-3 text-muted small">or</span>
                  <hr className="flex-grow-1" />
                </div>

                <button onClick={handleDemo} className="btn btn-outline-secondary btn-lg">
                  Try Demo
                </button>
              </div>

              {error && (
                <div className="alert alert-danger mt-4 mb-0" role="alert">
                  {error.message}
                </div>
              )}

              <p className="text-muted small mt-4 mb-0">
                <strong>Invitation only</strong> - Sign-in is restricted to approved users.
                <br />
                Try the demo to explore the app with sample data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
