interface SidebarProps {
  currentYear: number;
  onYearClick: (year: number) => void;
}

const AVAILABLE_YEARS = [2025, 2024, 2023];

export default function Sidebar({ currentYear, onYearClick }: SidebarProps) {
  return (
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
            {AVAILABLE_YEARS.map((year) => (
              <li key={year} className="nav-item">
                <button
                  className={`nav-link d-flex align-items-center gap-2 ${
                    year === currentYear ? "active" : ""
                  }`}
                  onClick={() => onYearClick(year)}
                >
                  <svg className="bi">
                    <use xlinkHref="#file-earmark-text" />
                  </svg>
                  {year} Ride Data
                </button>
              </li>
            ))}
          </ul>

          <hr className="my-3" />
        </div>
      </div>
    </div>
  );
}
