import React from "react";
import "./App.css";
import "bootstrap/dist/css/bootstrap.css";
import "./css/dashboard.css";
import DistanceChart from "./components/DistanceChart";
import PacingChart from "./components/PacingChart";

function App() {
  const [newYear, setNewYear] = React.useState(2025);
  const handleYearClick = (year: number) => {
    setNewYear(year);
  };
  return (
    <div className="App">
      <header className="navbar sticky-top bg-dark flex-md-nowrap p-0 shadow" data-bs-theme="dark">
        <div className="navbar-brand col-md-3 col-lg-2 me-0 px-3 fs-6 text-white">Desire Lines</div>

        <ul className="navbar-nav flex-row d-md-none">
          <li className="nav-item text-nowrap">
            <button
              className="nav-link px-3 text-white"
              type="button"
              data-bs-toggle="collapse"
              data-bs-target="#navbarSearch"
              aria-controls="navbarSearch"
              aria-expanded="false"
              aria-label="Toggle search"
            >
              <svg className="bi">
                <use xlinkHref="#search" />
              </svg>
            </button>
          </li>
          <li className="nav-item text-nowrap">
            <button
              className="nav-link px-3 text-white"
              type="button"
              data-bs-toggle="offcanvas"
              data-bs-target="#sidebarMenu"
              aria-controls="sidebarMenu"
              aria-expanded="false"
              aria-label="Toggle navigation"
            >
              <svg className="bi">
                <use xlinkHref="#list" />
              </svg>
            </button>
          </li>
        </ul>

        <div id="navbarSearch" className="navbar-search w-100 collapse">
          <input
            className="form-control w-100 rounded-0 border-0"
            type="text"
            placeholder="Search"
            aria-label="Search"
          />
        </div>
      </header>
      <div className="container-fluid">
        <div className="row">
          <div className="sidebar border border-right col-md-3 col-lg-2 p-0 bg-body-tertiary">
            <div
              className="offcanvas-md offcanvas-end bg-body-tertiary"
              data-tabindex="-1"
              id="sidebarMenu"
              aria-labelledby="sidebarMenuLabel"
            >
              <div className="offcanvas-header">
                <h5 className="offcanvas-title" id="sidebarMenuLabel">
                  Desire Lines
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  data-bs-dismiss="offcanvas"
                  data-bs-target="#sidebarMenu"
                  aria-label="Close"
                ></button>
              </div>
              <div className="offcanvas-body d-md-flex flex-column p-0 pt-lg-3 overflow-y-auto">
                <h6 className="sidebar-heading d-flex justify-content-between align-items-center px-3 mt-4 mb-1 text-body-secondary text-uppercase">
                  <span>Ride Data</span>
                </h6>
                <ul className="nav flex-column mb-auto">
                  <li className="nav-item">
                    <button
                      className="nav-link d-flex align-items-center gap-2"
                      onClick={() => {
                        handleYearClick(2025);
                      }}
                    >
                      <svg className="bi">
                        <use xlinkHref="#file-earmark-text" />
                      </svg>
                      2025 Ride Data
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className="nav-link d-flex align-items-center gap-2"
                      onClick={() => {
                        handleYearClick(2024);
                      }}
                    >
                      <svg className="bi">
                        <use xlinkHref="#file-earmark-text" />
                      </svg>
                      2024 Ride Data
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className="nav-link d-flex align-items-center gap-2"
                      onClick={() => {
                        handleYearClick(2023);
                      }}
                    >
                      <svg className="bi">
                        <use xlinkHref="#file-earmark-text" />
                      </svg>
                      2023 Ride Data
                    </button>
                  </li>
                </ul>

                <hr className="my-3" />
              </div>
            </div>
          </div>

          <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
            <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
              <h1 className="h2">Desirelines as of {new Date().toDateString()}</h1>
            </div>
            <DistanceChart year={newYear} />
            <PacingChart year={newYear} />
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
