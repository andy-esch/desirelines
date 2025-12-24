import Logo from "../Logo";
import AuthButton from "../AuthButton";

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
        <AuthButton />
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
            <svg width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
              <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/>
            </svg>
          </button>
        </li>
      </ul>
    </header>
  );
}
