import { lazy, Suspense } from "react";
import "./css/tailwind.css";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import Header from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import PageLoader from "./components/PageLoader";
import ErrorBoundary from "./components/ErrorBoundary";
import { PageErrorFallback } from "./components/PageErrorFallback";
import { ServiceProvider } from "./contexts/ServiceContext";
import { AuthProvider } from "./contexts/AuthContext";
import { useCurrentYear } from "./hooks/useCurrentYear";
import { getDemoSports } from "./utils/demoDataGenerator";

// Lazy load pages for code splitting
// Each page becomes a separate chunk, loaded on-demand
const Dashboard = lazy(() => import("./pages/Dashboard"));
const UnifiedSportPage = lazy(() => import("./pages/UnifiedSportPage"));
const DemoSportPage = lazy(() => import("./pages/DemoSportPage"));
const ActivitiesPage = lazy(() => import("./pages/ActivitiesPage"));
const OriginsPage = lazy(() => import("./pages/OriginsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

/** Sports with demo data generators (derived from demo config) */
const DEMO_SPORTS = getDemoSports();

/** Wrapper that adds an error boundary with PageErrorFallback */
function WithErrorBoundary({
  children,
  resetKeys,
}: {
  children: React.ReactNode;
  resetKeys?: unknown[];
}) {
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <PageErrorFallback error={error} onReset={resetErrorBoundary} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function App() {
  const currentYear = useCurrentYear();

  return (
    <ServiceProvider>
      <AuthProvider>
        <BrowserRouter>
          <div className="App flex flex-col" style={{ minHeight: "100vh" }}>
            <Header />
            <main className="grow flex flex-col">
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  {/* Dashboard - landing page for all users */}
                  <Route
                    path="/"
                    element={
                      <WithErrorBoundary>
                        <Dashboard />
                      </WithErrorBoundary>
                    }
                  />
                  <Route
                    path="/dashboard"
                    element={
                      <WithErrorBoundary>
                        <Dashboard />
                      </WithErrorBoundary>
                    }
                  />

                  {/* Activities list page */}
                  <Route
                    path="/activities"
                    element={
                      <WithErrorBoundary>
                        <ActivitiesPage />
                      </WithErrorBoundary>
                    }
                  />

                  {/* Origins/About page */}
                  <Route
                    path="/origins"
                    element={
                      <WithErrorBoundary>
                        <OriginsPage />
                      </WithErrorBoundary>
                    }
                  />

                  {/* Settings page (authenticated users only) */}
                  <Route
                    path="/settings"
                    element={
                      <WithErrorBoundary>
                        <SettingsPage />
                      </WithErrorBoundary>
                    }
                  />

                  {/* Sport detail pages - dynamic routing for any sport */}
                  <Route path="/:sport" element={<SportRedirect currentYear={currentYear} />} />
                  <Route path="/:sport/:year" element={<DynamicSportPage />} />

                  {/* Demo routes - dedicated demo experience (only for sports with demo data) */}
                  <Route
                    path="/demo"
                    element={
                      <WithErrorBoundary>
                        <Dashboard />
                      </WithErrorBoundary>
                    }
                  />
                  {DEMO_SPORTS.map((sport) => (
                    <Route
                      key={`demo-${sport}`}
                      path={`/demo/${sport}`}
                      element={<Navigate to={`/demo/${sport}/${currentYear}`} replace />}
                    />
                  ))}
                  {DEMO_SPORTS.map((sport) => (
                    <Route
                      key={`demo-${sport}-year`}
                      path={`/demo/${sport}/:year`}
                      element={
                        <WithErrorBoundary resetKeys={[sport]}>
                          <DemoSportPage sport={sport} />
                        </WithErrorBoundary>
                      }
                    />
                  ))}

                  {/* 404 - redirect unknown paths to dashboard */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </main>
            <Footer />
          </div>
        </BrowserRouter>
      </AuthProvider>
    </ServiceProvider>
  );
}

/** Redirect /:sport to /:sport/:currentYear */
function SportRedirect({ currentYear }: { currentYear: number }) {
  const { sport } = useParams<{ sport: string }>();
  return <Navigate to={`/${sport}/${currentYear}`} replace />;
}

/** Dynamic sport page that extracts sport from URL params and wraps in error boundary */
function DynamicSportPage() {
  const { sport, year } = useParams<{ sport: string; year: string }>();
  if (!sport) {
    return <Navigate to="/" replace />;
  }
  return (
    <WithErrorBoundary resetKeys={[sport, year]}>
      <UnifiedSportPage sport={sport} />
    </WithErrorBoundary>
  );
}

export default App;
