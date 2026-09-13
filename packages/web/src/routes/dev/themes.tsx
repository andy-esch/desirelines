import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy } from "react";

// Dev-only. `import.meta.env.DEV` is replaced with `false` in production builds, so the
// dynamic import below is dead code there and the gallery module is never bundled; the
// route itself answers with the not-found page.
const ThemeGalleryPage = import.meta.env.DEV
  ? lazy(() => import("../../pages/dev/ThemeGalleryPage"))
  : () => null;

export const Route = createFileRoute("/dev/themes")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: ThemeGalleryPage,
});
