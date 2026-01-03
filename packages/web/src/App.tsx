import "bootstrap/dist/css/bootstrap.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "./css/variables.css";
import "./css/dashboard.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import Dashboard from "./pages/Dashboard";
import UnifiedSportPage from "./pages/UnifiedSportPage";
import DemoSportPage from "./pages/DemoSportPage";
import ActivitiesPage from "./pages/ActivitiesPage";
import OriginsPage from "./pages/OriginsPage";
import SettingsPage from "./pages/SettingsPage";

const VALID_SPORTS = ["cycling", "running", "yoga"] as const;

function App() {
  const currentYear = new Date().getFullYear();

  return (
    <BrowserRouter>
      <div className="App d-flex flex-column" style={{ minHeight: "100vh" }}>
        <Header />
        <main className="flex-grow-1 d-flex flex-column">
          <Routes>
            {/* Dashboard - landing page for all users */}
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />

            {/* Activities list page */}
            <Route path="/activities" element={<ActivitiesPage />} />

            {/* Origins/About page */}
            <Route path="/origins" element={<OriginsPage />} />

            {/* Settings page (authenticated users only) */}
            <Route path="/settings" element={<SettingsPage />} />

            {/* Sport detail pages - data source based on auth state */}
            {VALID_SPORTS.map((sport) => (
              <Route
                key={sport}
                path={`/${sport}`}
                element={<Navigate to={`/${sport}/${currentYear}`} replace />}
              />
            ))}
            {VALID_SPORTS.map((sport) => (
              <Route
                key={`${sport}-year`}
                path={`/${sport}/:year`}
                element={<UnifiedSportPage sport={sport} />}
              />
            ))}

            {/* Demo routes - dedicated demo experience */}
            <Route path="/demo" element={<Dashboard />} />
            {VALID_SPORTS.map((sport) => (
              <Route
                key={`demo-${sport}`}
                path={`/demo/${sport}`}
                element={<Navigate to={`/demo/${sport}/${currentYear}`} replace />}
              />
            ))}
            {VALID_SPORTS.map((sport) => (
              <Route
                key={`demo-${sport}-year`}
                path={`/demo/${sport}/:year`}
                element={<DemoSportPage sport={sport} />}
              />
            ))}

            {/* 404 - redirect unknown paths to dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;
