import { Suspense, useEffect, useRef } from "react";
import { createRootRoute, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import Header from "../components/layout/Header";
import { Footer } from "../components/layout/Footer";
import PageLoader from "../components/PageLoader";
import PageTransition from "../components/PageTransition";
import { PageErrorFallback } from "../components/PageErrorFallback";
import { useScrolled } from "../hooks/useScrolled";
import { handleChunkLoadError } from "../utils/chunkLoadHandler";

function RootLayout() {
  const scrolled = useScrolled(4);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip initial mount — only focus on subsequent navigations
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <div className="App flex flex-col min-h-screen bg-bg-body">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-bg-body focus:text-accent-cyan focus:rounded focus:outline focus:outline-2 focus:outline-accent-cyan"
      >
        Skip to content
      </a>
      <Header scrolled={scrolled} />
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        className="grow flex flex-col outline-none"
      >
        <Suspense fallback={<PageLoader />}>
          <PageTransition>
            <Outlet />
          </PageTransition>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

function RootErrorComponent({ error }: { error: Error }) {
  const router = useRouter();

  // Auto-reload for stale chunk errors (after a deploy)
  try {
    if (handleChunkLoadError(error)) return null;
  } catch {
    // Not a chunk error or reload already attempted — show fallback UI
  }

  return <PageErrorFallback error={error} onReset={() => router.invalidate()} />;
}

function NotFoundComponent() {
  const router = useRouter();

  useEffect(() => {
    router.navigate({ to: "/", replace: true });
  }, [router]);

  return null;
}

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorComponent,
  notFoundComponent: NotFoundComponent,
});
