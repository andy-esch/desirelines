import { useState } from "react";
import "./App.css";
import "bootstrap/dist/css/bootstrap.css";
import "./css/dashboard.css";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import DistanceChart from "./components/charts/DistanceChart";
import PacingChart from "./components/charts/PacingChart";

function App() {
  const [currentYear, setCurrentYear] = useState(2025);

  const handleYearClick = (year: number) => {
    setCurrentYear(year);
  };

  return (
    <div className="App">
      <Header />
      <div className="container-fluid">
        <div className="row">
          <Sidebar currentYear={currentYear} onYearClick={handleYearClick} />

          <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
            <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
              <h1 className="h2">Desirelines as of {new Date().toDateString()}</h1>
            </div>
            <DistanceChart year={currentYear} />
            <PacingChart year={currentYear} />
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
