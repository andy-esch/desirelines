import { lazy, Suspense, useEffect, useRef } from "react";
import "./css/tailwind.css";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  useLocation,
  useParams,
  useRouteError,
} from "react-router-dom";
import Header from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import PageLoader from "./components/PageLoader";
import PageTransition from "./components/PageTransition";
import { PageErrorFallback } from "./components/PageErrorFallback";
import { ServiceProvider } from "./contexts/ServiceContext";
import { AuthProvider } from "./contexts/AuthContext";
import { UIStateProvider } from "./contexts/UIStateContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useCurrentYear } from "./hooks/useCurrentYear";
import { getDemoSports } from "./utils/demoDataGenerator";
import { useScrolled } from "./hooks/useScrolled";
import { handleChunkLoadError } from "./utils/chunkLoadHandler";

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

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/** Route-level error fallback — uses React Router's useRouteError hook.
 *  Also handles stale chunk load errors by triggering a one-time reload. */
function RouteErrorFallback() {
  const error = useRouteError();

  // Auto-reload for stale chunk errors (after a deploy). handleChunkLoadError
  // returns true if a reload was triggered (page is navigating away) — render
  // nothing while that happens. If it throws, the error is not a chunk error
  // (or reload was already attempted), so fall through to the normal error UI.
  try {
    if (handleChunkLoadError(error)) return null;
  } catch {
    // Not a chunk error or reload already attempted — show fallback UI below
  }

  const errorObj = error instanceof Error ? error : new Error(String(error));
  return <PageErrorFallback error={errorObj} onReset={() => window.location.reload()} />;
}

/** Shared errorElement for all routes */
const routeErrorElement = <RouteErrorFallback />;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Root layout — Header, main content area (with Suspense), and Footer */
function RootLayout() {
  const scrolled = useScrolled(4);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip initial mount — only focus on subsequent navigations
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <div className="App flex flex-col min-h-screen bg-bg-body">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-bg-body focus:text-accent-cyan focus:rounded focus:outline focus:outline-2 focus:outline-accent-cyan"
      >
        Skip to content
      </a>
      <ScrollRestoration />
      <Header scrolled={scrolled} />
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        className="grow flex flex-col outline-none"
      >
        <Suspense fallback={<PageLoader />}>
          <PageTransition>
            <Outlet />
          </PageTransition>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route helper components
// ---------------------------------------------------------------------------

/** Redirect /:sport to /:sport/:currentYear */
function SportRedirect() {
  const { sport } = useParams<{ sport: string }>();
  const currentYear = useCurrentYear();
  return <Navigate to={`/${sport}/${currentYear}`} replace />;
}

/** Redirect /demo/:sport to /demo/:sport/:currentYear */
function DemoSportRedirect({ sport }: { sport: string }) {
  const currentYear = useCurrentYear();
  return <Navigate to={`/demo/${sport}/${currentYear}`} replace />;
}

/** Dynamic sport page — extracts sport from URL params */
function DynamicSportPage() {
  const { sport } = useParams<{ sport: string }>();
  if (!sport) {
    return <Navigate to="/" replace />;
  }
  return <UnifiedSportPage sport={sport} />;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      // Dashboard — landing page for all users
      { path: "/", element: <Dashboard />, errorElement: routeErrorElement },
      { path: "/dashboard", element: <Dashboard />, errorElement: routeErrorElement },

      // Activities list page
      { path: "/activities", element: <ActivitiesPage />, errorElement: routeErrorElement },

      // Origins/About page
      { path: "/origins", element: <OriginsPage />, errorElement: routeErrorElement },

      // Settings page
      { path: "/settings", element: <SettingsPage />, errorElement: routeErrorElement },

      // Sport detail pages — dynamic routing for any sport
      { path: "/:sport", element: <SportRedirect />, errorElement: routeErrorElement },
      { path: "/:sport/:year", element: <DynamicSportPage />, errorElement: routeErrorElement },

      // Demo routes — dedicated demo experience (only for sports with demo data)
      { path: "/demo", element: <Dashboard />, errorElement: routeErrorElement },
      ...DEMO_SPORTS.map((sport) => ({
        path: `/demo/${sport}`,
        element: <DemoSportRedirect sport={sport} />,
      })),
      ...DEMO_SPORTS.map((sport) => ({
        path: `/demo/${sport}/:year`,
        element: <DemoSportPage sport={sport} />,
        errorElement: routeErrorElement,
      })),

      // 404 — redirect unknown paths to dashboard
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

function App() {
  return (
    <ThemeProvider>
      <ServiceProvider>
        <AuthProvider>
          <UIStateProvider>
            <RouterProvider router={router} />
          </UIStateProvider>
        </AuthProvider>
      </ServiceProvider>
    </ThemeProvider>
  );
}

export default App;
