import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Skeleton, { SkeletonRegion } from "./Skeleton";
import PageLoader from "./PageLoader";
import DashboardSkeleton from "./skeletons/DashboardSkeleton";
import SportPageSkeleton from "./skeletons/SportPageSkeleton";

describe("Skeleton", () => {
  it("draws every block and its shimmer from the theme's skeleton slots", () => {
    const { container } = render(
      <>
        <Skeleton height={20} />
        <Skeleton width={80} height={12} />
      </>
    );
    const blocks = [...container.querySelectorAll<HTMLElement>(".react-loading-skeleton")];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.style.getPropertyValue("--base-color")).toBe("var(--color-skeleton)");
      expect(block.style.getPropertyValue("--custom-highlight-background")).toBe(
        "linear-gradient(90deg, transparent 0%, var(--color-skeleton-shimmer) 50%, transparent 100%)"
      );
    }
  });
});

describe("SkeletonRegion", () => {
  it("says Loading… to screen readers under the region's name", () => {
    render(
      <SkeletonRegion label="Loading weekly summary">
        <Skeleton height={14} />
      </SkeletonRegion>
    );
    const region = screen.getByRole("status", { name: "Loading weekly summary" });
    expect(screen.getByText("Loading…")).toHaveClass("sr-only");
    expect(region).toContainElement(screen.getByText("Loading…"));
  });
});

describe.each([
  ["PageLoader", PageLoader],
  ["DashboardSkeleton", DashboardSkeleton],
  ["SportPageSkeleton", SportPageSkeleton],
])("%s", (_, Screen) => {
  it("tells screen readers the page is loading", () => {
    render(<Screen />);
    // The blocks themselves hold only zero-width non-joiners.
    expect(screen.getByRole("status")).toHaveTextContent(/^Loading…\u200c*$/);
  });
});
