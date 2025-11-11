import "bootstrap/dist/css/bootstrap.css";
import "./css/dashboard.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/layout/Header";
import FixtureBanner from "./components/FixtureBanner";
import SportPage from "./pages/SportPage";

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Header />
        <FixtureBanner />
        <Routes>
          <Route path="/" element={<Navigate to="/cycling" replace />} />
          <Route path="/cycling" element={<SportPage sport="cycling" />} />
          <Route path="/cycling/:year" element={<SportPage sport="cycling" />} />
          <Route path="/running" element={<SportPage sport="running" />} />
          <Route path="/running/:year" element={<SportPage sport="running" />} />
          <Route path="/yoga" element={<SportPage sport="yoga" />} />
          <Route path="/yoga/:year" element={<SportPage sport="yoga" />} />
          <Route path="*" element={<div>404 - Page Not Found</div>} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
