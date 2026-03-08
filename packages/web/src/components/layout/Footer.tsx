import { Link } from "@tanstack/react-router";
import { useCurrentYear } from "../../hooks/useCurrentYear";

const GitHubIcon = () => (
  <svg
    width="14"
    height="14"
    fill="currentColor"
    viewBox="0 0 16 16"
    style={{ verticalAlign: "text-bottom" }}
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

/**
 * Site footer with copyright, Origins link, and GitHub link
 */
export function Footer() {
  const currentYear = useCurrentYear();
  const startYear = 2024;
  const yearRange = currentYear > startYear ? `${startYear}-${currentYear}` : `${startYear}`;

  return (
    <footer
      className="py-2 text-center text-slate-light"
      style={{
        background: `linear-gradient(
          135deg,
          rgba(255, 0, 255, 0.12),
          rgba(0, 255, 255, 0.12),
          rgba(0, 255, 128, 0.12)
        )`,
        borderTop: "1px solid var(--color-surface-border)",
        fontSize: "0.85rem",
      }}
    >
      <div className="container mx-auto flex justify-center items-center gap-2 flex-wrap">
        <Link
          to="/origins"
          className="text-slate-light hover:text-accent-cyan min-h-[44px] inline-flex items-center"
        >
          Origins
        </Link>
        <span style={{ opacity: 0.5 }}>&bull;</span>
        <a
          href="https://github.com/andy-esch/desirelines/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-light hover:text-accent-cyan min-h-[44px] inline-flex items-center"
          style={{ gap: "0.35rem" }}
        >
          <GitHubIcon />
          GitHub
        </a>
        <span style={{ opacity: 0.5 }}>&bull;</span>
        <span className="min-h-[44px] inline-flex items-center">
          &copy; {yearRange} Desirelines
        </span>
      </div>
    </footer>
  );
}
