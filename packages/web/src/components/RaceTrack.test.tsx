import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RaceTrack, { RaceTrackLegend } from "./RaceTrack";

describe("RaceTrack", () => {
  describe("basic rendering", () => {
    it("renders with default markers", () => {
      render(<RaceTrack primaryPosition={50} />);

      // Should have dragon marker
      expect(screen.getByTitle(/You: 50%/)).toBeInTheDocument();
    });

    it("renders pace marker when pacePosition is provided", () => {
      render(<RaceTrack primaryPosition={50} pacePosition={40} />);

      expect(screen.getByTitle(/You: 50%/)).toBeInTheDocument();
      expect(screen.getByTitle(/Goal pace: 40%/)).toBeInTheDocument();
    });

    it("hides pace marker when showPace is false", () => {
      render(<RaceTrack primaryPosition={50} pacePosition={40} showPace={false} />);

      expect(screen.getByTitle(/You: 50%/)).toBeInTheDocument();
      expect(screen.queryByTitle(/Goal pace/)).not.toBeInTheDocument();
    });
  });

  describe("position clamping", () => {
    it("clamps primary position to minimum of 0%", () => {
      render(<RaceTrack primaryPosition={-10} />);

      expect(screen.getByTitle(/You: 0%/)).toBeInTheDocument();
    });

    it("clamps primary position to maximum of 100%", () => {
      render(<RaceTrack primaryPosition={150} />);

      expect(screen.getByTitle(/You: 100%/)).toBeInTheDocument();
    });

    it("clamps pace position to valid range", () => {
      render(<RaceTrack primaryPosition={50} pacePosition={-20} showPace={true} />);

      expect(screen.getByTitle(/Goal pace: 0%/)).toBeInTheDocument();
    });

    it("handles exactly 0% position", () => {
      render(<RaceTrack primaryPosition={0} />);

      expect(screen.getByTitle(/You: 0%/)).toBeInTheDocument();
    });

    it("handles exactly 100% position", () => {
      render(<RaceTrack primaryPosition={100} />);

      expect(screen.getByTitle(/You: 100%/)).toBeInTheDocument();
    });
  });

  describe("custom markers", () => {
    it("renders custom primary marker", () => {
      render(<RaceTrack primaryPosition={50} primaryMarker="🚴" />);

      const marker = screen.getByTitle(/You: 50%/);
      expect(marker).toHaveTextContent("🚴");
    });

    it("renders custom pace marker", () => {
      render(<RaceTrack primaryPosition={50} pacePosition={40} paceMarker="🎯" showPace={true} />);

      const marker = screen.getByTitle(/Goal pace: 40%/);
      expect(marker).toHaveTextContent("🎯");
    });
  });

  describe("styling", () => {
    it("applies custom height", () => {
      const { container } = render(<RaceTrack primaryPosition={50} height={40} />);

      const track = container.firstChild as HTMLElement;
      expect(track.style.height).toBe("40px");
    });

    it("applies custom className", () => {
      const { container } = render(<RaceTrack primaryPosition={50} className="my-custom-class" />);

      const track = container.firstChild as HTMLElement;
      expect(track.classList.contains("my-custom-class")).toBe(true);
    });

    it("applies custom inline styles", () => {
      const { container } = render(
        <RaceTrack primaryPosition={50} style={{ marginTop: "10px" }} />
      );

      const track = container.firstChild as HTMLElement;
      expect(track.style.marginTop).toBe("10px");
    });
  });

  describe("edge cases", () => {
    it("renders without pacePosition", () => {
      render(<RaceTrack primaryPosition={75} />);

      expect(screen.getByTitle(/You: 75%/)).toBeInTheDocument();
      expect(screen.queryByTitle(/Goal pace/)).not.toBeInTheDocument();
    });

    it("handles both markers at same position", () => {
      render(<RaceTrack primaryPosition={50} pacePosition={50} showPace={true} />);

      // Both should render (dragon on top via z-index)
      expect(screen.getByTitle(/You: 50%/)).toBeInTheDocument();
      expect(screen.getByTitle(/Goal pace: 50%/)).toBeInTheDocument();
    });
  });
});

describe("RaceTrackLegend", () => {
  describe("basic rendering", () => {
    it("renders default markers and labels", () => {
      render(<RaceTrackLegend />);

      expect(screen.getByText("🐲")).toBeInTheDocument();
      expect(screen.getByText("You")).toBeInTheDocument();
      expect(screen.getByText("👻")).toBeInTheDocument();
      expect(screen.getByText("Pace")).toBeInTheDocument();
    });

    it("hides pace legend when showPace is false", () => {
      render(<RaceTrackLegend showPace={false} />);

      expect(screen.getByText("🐲")).toBeInTheDocument();
      expect(screen.getByText("You")).toBeInTheDocument();
      expect(screen.queryByText("👻")).not.toBeInTheDocument();
      expect(screen.queryByText("Pace")).not.toBeInTheDocument();
    });
  });

  describe("custom markers and labels", () => {
    it("renders custom primary marker and label", () => {
      render(<RaceTrackLegend primaryMarker="🚴" primaryLabel="Cyclist" />);

      expect(screen.getByText("🚴")).toBeInTheDocument();
      expect(screen.getByText("Cyclist")).toBeInTheDocument();
    });

    it("renders custom pace marker and label", () => {
      render(<RaceTrackLegend paceMarker="🎯" paceLabel="Target" />);

      expect(screen.getByText("🎯")).toBeInTheDocument();
      expect(screen.getByText("Target")).toBeInTheDocument();
    });
  });

  describe("styling", () => {
    it("applies custom className", () => {
      const { container } = render(<RaceTrackLegend className="my-legend-class" />);

      const legend = container.firstChild as HTMLElement;
      expect(legend.classList.contains("my-legend-class")).toBe(true);
    });
  });
});
