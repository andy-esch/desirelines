import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActivityTable from "./ActivityTable";
import type { ActivitySummary } from "../api/activities";

describe("ActivityTable", () => {
  const mockActivities: ActivitySummary[] = [
    {
      id: 123456789,
      name: "Morning Ride",
      type: "Ride",
      sport: "cycling",
      startDateLocal: "2025-12-28T08:30:00",
      distanceMeters: 45000,
      movingTimeSeconds: 5400,
      elevationMeters: 450,
    },
    {
      id: 123456790,
      name: "Evening Run",
      type: "Run",
      sport: "running",
      startDateLocal: "2025-12-27T18:00:00",
      distanceMeters: 8000,
      movingTimeSeconds: 2400,
      elevationMeters: 50,
    },
    {
      id: 123456791,
      name: "Yoga Session",
      type: "Yoga",
      sport: "yoga",
      startDateLocal: "2025-12-26T07:00:00",
      distanceMeters: 0,
      movingTimeSeconds: 3600,
    },
  ];

  const defaultProps = {
    activities: mockActivities,
    isLoading: false,
    error: null,
    hasMore: false,
    onLoadMore: vi.fn(),
    onRetry: vi.fn(),
  };

  describe("rendering", () => {
    it("renders table with activities", () => {
      render(<ActivityTable {...defaultProps} />);

      expect(screen.getByText("Morning Ride")).toBeInTheDocument();
      expect(screen.getByText("Evening Run")).toBeInTheDocument();
      expect(screen.getByText("Yoga Session")).toBeInTheDocument();
    });

    it("renders column headers", () => {
      render(<ActivityTable {...defaultProps} />);

      expect(screen.getByText("Date")).toBeInTheDocument();
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Sport")).toBeInTheDocument();
      expect(screen.getByText("Distance")).toBeInTheDocument();
      expect(screen.getByText("Time")).toBeInTheDocument();
      expect(screen.getByText("Elevation")).toBeInTheDocument();
      expect(screen.getByText("Pace/Speed")).toBeInTheDocument();
    });

    it("renders sport badges", () => {
      render(<ActivityTable {...defaultProps} />);

      expect(screen.getByText("cycling")).toBeInTheDocument();
      expect(screen.getByText("running")).toBeInTheDocument();
      expect(screen.getByText("yoga")).toBeInTheDocument();
    });

    it("renders Strava links for each activity", () => {
      render(<ActivityTable {...defaultProps} />);

      const links = screen.getAllByTitle("View on Strava");
      expect(links).toHaveLength(3);
      expect(links[0]).toHaveAttribute("href", "https://www.strava.com/activities/123456789");
      expect(links[1]).toHaveAttribute("href", "https://www.strava.com/activities/123456790");
    });

    it("opens Strava links in new tab", () => {
      render(<ActivityTable {...defaultProps} />);

      const links = screen.getAllByTitle("View on Strava");
      links.forEach((link) => {
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
      });
    });
  });

  describe("formatting", () => {
    it("formats distance in miles by default", () => {
      render(<ActivityTable {...defaultProps} />);

      // 45000m = ~27.96 miles
      expect(screen.getByText("28.0 mi")).toBeInTheDocument();
      // 8000m = ~4.97 miles
      expect(screen.getByText("5.0 mi")).toBeInTheDocument();
    });

    it("formats distance in kilometers when specified", () => {
      render(<ActivityTable {...defaultProps} distanceUnit="kilometers" />);

      // 45000m = 45 km
      expect(screen.getByText("45.0 km")).toBeInTheDocument();
      // 8000m = 8 km
      expect(screen.getByText("8.0 km")).toBeInTheDocument();
    });

    it("formats time as H:MM:SS for long activities", () => {
      render(<ActivityTable {...defaultProps} />);

      // 5400 seconds = 1:30:00
      expect(screen.getByText("1:30:00")).toBeInTheDocument();
      // 3600 seconds = 1:00:00
      expect(screen.getByText("1:00:00")).toBeInTheDocument();
    });

    it("formats time as MM:SS for short activities", () => {
      render(<ActivityTable {...defaultProps} />);

      // 2400 seconds = 40:00
      expect(screen.getByText("40:00")).toBeInTheDocument();
    });

    it("formats elevation in feet by default", () => {
      render(<ActivityTable {...defaultProps} />);

      // 450m = ~1476 feet
      expect(screen.getByText("1476 ft")).toBeInTheDocument();
    });

    it("formats elevation in meters when specified", () => {
      render(<ActivityTable {...defaultProps} elevationUnit="meters" />);

      expect(screen.getByText("450 m")).toBeInTheDocument();
    });

    it("shows dash for activities without elevation", () => {
      render(<ActivityTable {...defaultProps} />);

      // Yoga activity has no elevation
      const cells = screen.getAllByText("-");
      expect(cells.length).toBeGreaterThan(0);
    });

    it("calculates speed for cycling activities", () => {
      render(<ActivityTable {...defaultProps} />);

      // 45000m in 5400s = 8.33 m/s = ~18.6 mph
      expect(screen.getByText("18.6 mph")).toBeInTheDocument();
    });

    it("calculates pace for running activities", () => {
      render(<ActivityTable {...defaultProps} />);

      // 8000m in 2400s = 4.97 miles in 40min = ~8:02/mi
      expect(screen.getByText("8:03/mi")).toBeInTheDocument();
    });

    it("shows dash for pace on yoga activities", () => {
      render(<ActivityTable {...defaultProps} />);

      // Yoga has no distance, so no pace
      const cells = screen.getAllByText("-");
      expect(cells.length).toBeGreaterThan(0);
    });
  });

  describe("loading state", () => {
    it("shows loading spinner when loading", () => {
      render(<ActivityTable {...defaultProps} isLoading={true} />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("shows activities while loading more", () => {
      render(<ActivityTable {...defaultProps} isLoading={true} />);

      expect(screen.getByText("Morning Ride")).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty message when no activities", () => {
      render(<ActivityTable {...defaultProps} activities={[]} />);

      expect(screen.getByText("No activities found for the selected filters.")).toBeInTheDocument();
    });

    it("does not show empty message while loading", () => {
      render(<ActivityTable {...defaultProps} activities={[]} isLoading={true} />);

      expect(
        screen.queryByText("No activities found for the selected filters.")
      ).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows error message", () => {
      const error = new Error("Failed to load activities");
      render(<ActivityTable {...defaultProps} error={error} />);

      expect(screen.getByText("Error loading activities:")).toBeInTheDocument();
      expect(screen.getByText("Failed to load activities")).toBeInTheDocument();
    });

    it("shows retry button on error", () => {
      const error = new Error("Failed to load activities");
      render(<ActivityTable {...defaultProps} error={error} />);

      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    it("calls onRetry when retry button clicked", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      const error = new Error("Failed to load activities");
      render(<ActivityTable {...defaultProps} error={error} onRetry={onRetry} />);

      await user.click(screen.getByRole("button", { name: "Retry" }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("pagination", () => {
    it("shows Load More button when hasMore is true", () => {
      render(<ActivityTable {...defaultProps} hasMore={true} />);

      expect(screen.getByRole("button", { name: "Load More" })).toBeInTheDocument();
    });

    it("hides Load More button when hasMore is false", () => {
      render(<ActivityTable {...defaultProps} hasMore={false} />);

      expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
    });

    it("hides Load More button while loading", () => {
      render(<ActivityTable {...defaultProps} hasMore={true} isLoading={true} />);

      expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
    });

    it("calls onLoadMore when Load More clicked", async () => {
      const user = userEvent.setup();
      const onLoadMore = vi.fn();
      render(<ActivityTable {...defaultProps} hasMore={true} onLoadMore={onLoadMore} />);

      await user.click(screen.getByRole("button", { name: "Load More" }));

      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it("shows activity count when all loaded", () => {
      render(<ActivityTable {...defaultProps} hasMore={false} />);

      expect(screen.getByText("Showing all 3 activities")).toBeInTheDocument();
    });
  });
});
