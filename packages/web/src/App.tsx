import "bootstrap/dist/css/bootstrap.css";
import "./css/dashboard.css";
import Header from "./components/layout/Header";
import FixtureBanner from "./components/FixtureBanner";
import Dashboard from "./pages/Dashboard";

function App() {
  return (
    <div className="App">
      <Header />
      <FixtureBanner />
      <Dashboard />
    </div>
  );
}

export default App;
