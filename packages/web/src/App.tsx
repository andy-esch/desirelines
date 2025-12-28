import "bootstrap/dist/css/bootstrap.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "./css/dashboard.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/layout/Header";
import Dashboard from "./pages/Dashboard";
import UnifiedSportPage from "./pages/UnifiedSportPage";

const VALID_SPORTS = ["cycling", "running", "yoga"] as const;

function App() {
  const currentYear = new Date().getFullYear();

  return (
    <BrowserRouter>
      <div className="App">
        <Header />
        <Routes>
          {/* Dashboard - landing page for all users */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />

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

          {/* Legacy demo routes - redirect to new structure */}
          <Route path="/demo" element={<Navigate to="/" replace />} />
          <Route path="/demo/:sport" element={<Navigate to="/" replace />} />
          <Route path="/demo/:sport/:year" element={<Navigate to="/" replace />} />

          {/* 404 - redirect unknown paths to dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
