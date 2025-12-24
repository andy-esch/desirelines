import "bootstrap/dist/css/bootstrap.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "./css/dashboard.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/layout/Header";
import ProtectedRoute from "./components/ProtectedRoute";
import LandingPage from "./pages/LandingPage";
import SportPage from "./pages/SportPage";
import DemoSportPage from "./pages/DemoSportPage";

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Header />
        <Routes>
          {/* Landing page - shows sign in / demo options */}
          <Route path="/" element={<LandingPage />} />

          {/* Demo routes - fixture data, no auth required */}
          <Route path="/demo" element={<Navigate to="/demo/cycling" replace />} />
          <Route path="/demo/cycling" element={<DemoSportPage sport="cycling" />} />
          <Route path="/demo/cycling/:year" element={<DemoSportPage sport="cycling" />} />
          <Route path="/demo/running" element={<DemoSportPage sport="running" />} />
          <Route path="/demo/running/:year" element={<DemoSportPage sport="running" />} />
          <Route path="/demo/yoga" element={<DemoSportPage sport="yoga" />} />
          <Route path="/demo/yoga/:year" element={<DemoSportPage sport="yoga" />} />

          {/* Protected routes - require authentication */}
          <Route
            path="/cycling"
            element={
              <ProtectedRoute>
                <SportPage sport="cycling" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cycling/:year"
            element={
              <ProtectedRoute>
                <SportPage sport="cycling" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/running"
            element={
              <ProtectedRoute>
                <SportPage sport="running" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/running/:year"
            element={
              <ProtectedRoute>
                <SportPage sport="running" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/yoga"
            element={
              <ProtectedRoute>
                <SportPage sport="yoga" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/yoga/:year"
            element={
              <ProtectedRoute>
                <SportPage sport="yoga" />
              </ProtectedRoute>
            }
          />

          {/* 404 */}
          <Route
            path="*"
            element={
              <div className="container mt-5">
                <h1>404 - Page Not Found</h1>
              </div>
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
