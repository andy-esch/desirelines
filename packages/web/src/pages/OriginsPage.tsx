import { Link } from "react-router-dom";
import { NarrowPageLayout } from "../components/layout/PageLayout";

const GitHubIcon = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

/**
 * Origins page - explains the project philosophy and the meaning behind "desirelines"
 *
 * This is the basic static version. A more elaborate scrollytelling version
 * is planned for the future (see about-origins-page.md task).
 */
export default function OriginsPage() {
  return (
    <NarrowPageLayout background="origins" maxWidth="720px">
      <div className="text-slate-light">
        <h1 className="mb-3 font-light text-[2.5rem] neon-gradient-text">Origins</h1>

        <section className="mb-12">
          <h2 className="mb-3 text-accent-cyan font-normal text-2xl">What is Desirelines?</h2>
          <p className="lead leading-[1.7]">
            Desirelines is a personal fitness tracking application that helps you set and track
            progress toward your annual goals. Connect your Strava account and visualize your
            journey throughout the year.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="mb-3 text-accent-cyan font-normal text-2xl">The Name</h2>
          <p className="leading-[1.7]">
            In urban planning and landscape architecture, a "desire line" (or desire path) is a path
            created by foot traffic—the natural route people take when walking between two points,
            often cutting across lawns or ignoring paved walkways.
          </p>
          <p className="leading-[1.7]">
            These paths represent how people actually move, rather than how designers intended them
            to move. They're honest, efficient, and emerge organically from real behavior.
          </p>
          <p className="leading-[1.7]">
            Desirelines (the app) embraces this philosophy: track your actual progress, see where
            you're naturally headed, and use that insight to guide your goals. Your fitness journey
            isn't a perfectly paved path—it's the line you create through consistent movement.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="mb-3 text-accent-cyan font-normal text-2xl">Open Source</h2>
          <p className="leading-[1.7]">
            Desirelines is open source software. View the code, report issues, or contribute on
            GitHub.
          </p>
          <a
            href="https://github.com/andy-esch/desirelines/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary mt-2 inline-flex items-center gap-2"
          >
            <GitHubIcon />
            View on GitHub
          </a>
        </section>

        <section className="mt-12 pt-6 border-t border-white/10">
          <p className="text-center mb-0">
            <Link to="/" className="text-accent-cyan no-underline">
              &larr; Back to Dashboard
            </Link>
          </p>
        </section>
      </div>
    </NarrowPageLayout>
  );
}
