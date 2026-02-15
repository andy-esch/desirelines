import { lazy, Suspense, useRef, useEffect } from "react";
import "./css/tailwind.css";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useParams,
  useRouteError,
} from "react-router-dom";
import Header from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import PageLoader from "./components/PageLoader";
import { PageErrorFallback } from "./components/PageErrorFallback";
import { ServiceProvider } from "./contexts/ServiceContext";
import { AuthProvider } from "./contexts/AuthContext";
import { UIStateProvider } from "./contexts/UIStateContext";
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

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/** Route-level error fallback — uses React Router's useRouteError hook */
function RouteErrorFallback() {
  const error = useRouteError();
  const errorObj = error instanceof Error ? error : new Error(String(error));
  return <PageErrorFallback error={errorObj} onReset={() => window.location.reload()} />;
}

/** Shared errorElement for all routes */
const routeErrorElement = <RouteErrorFallback />;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Moves focus to the main content area on route changes for screen reader users */
function FocusOnNavigate({ mainRef }: { mainRef: React.RefObject<HTMLElement | null> }) {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip initial mount — only focus on subsequent navigations
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname, mainRef]);

  return null;
}

/** Root layout — Header, main content area (with Suspense), and Footer */
function RootLayout() {
  const mainRef = useRef<HTMLElement>(null);

  return (
    <>
      <FocusOnNavigate mainRef={mainRef} />
      <div className="App flex flex-col overflow-x-hidden" style={{ minHeight: "100vh" }}>
        <Header />
        <main ref={mainRef} tabIndex={-1} className="grow flex flex-col outline-none">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
        <Footer />
      </div>
    </>
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
    <ServiceProvider>
      <AuthProvider>
        <UIStateProvider>
          <RouterProvider router={router} />
        </UIStateProvider>
      </AuthProvider>
    </ServiceProvider>
  );
}

export default App;
