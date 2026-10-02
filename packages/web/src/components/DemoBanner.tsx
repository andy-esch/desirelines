import { Alert } from "./ui/alert";

/**
 * The banner across the top of a demo page: the data is generated, and signing in is by
 * invitation. It's static page chrome, not news, so it isn't a live region; screen readers
 * meet it in reading order like the rest of the page.
 */
export function DemoBanner() {
  return (
    <Alert variant="demo" className="rounded-none px-4 py-3 md:px-6">
      <strong className="text-(color:--demo-label-color)">Demo Mode</strong> — Viewing generated
      sample data. <span className="text-sm">Sign-in is invite-only.</span>
    </Alert>
  );
}
