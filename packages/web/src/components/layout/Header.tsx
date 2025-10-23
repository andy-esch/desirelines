import Logo from "../Logo";

export default function Header() {
  const currentDate = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <header
      className="navbar sticky-top flex-md-nowrap p-2 shadow"
      style={{ backgroundColor: "#2d3748" }}
    >
      <div className="col-md-3 col-lg-2 me-0 px-3 d-flex align-items-center">
        <div style={{ transform: "translateY(-1px)" }}>
          <Logo />
        </div>
      </div>

      <div className="d-flex align-items-center gap-3 px-3 ms-auto">
        <div className="navbar-text text-white-50 small d-none d-lg-block">{currentDate}</div>
      </div>

      {/* Mobile sidebar toggle */}
      <ul className="navbar-nav flex-row d-md-none">
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
            <svg className="bi" width="24" height="24" fill="currentColor">
              <use xlinkHref="#list" />
            </svg>
          </button>
        </li>
      </ul>
    </header>
  );
}
