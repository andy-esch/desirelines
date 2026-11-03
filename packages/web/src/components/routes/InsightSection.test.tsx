import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightSection } from "./InsightSection";
import MapInsightsDrawer from "./MapInsightsDrawer";

describe("InsightSection", () => {
  it("titles itself one level below the Charts drawer's heading", () => {
    render(
      <MapInsightsDrawer open onOpenChange={vi.fn()}>
        <InsightSection title="By sport" ariaLabel="Sport breakdown" isEmpty={false}>
          <p>body</p>
        </InsightSection>
      </MapInsightsDrawer>
    );
    expect(screen.getByRole("heading", { level: 2, name: "Charts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "By sport" })).toBeInTheDocument();
  });

  it("shows its empty text instead of the body", () => {
    render(
      <InsightSection
        title="By region"
        ariaLabel="Region breakdown"
        isEmpty
        emptyText="No region data."
      >
        <p>body</p>
      </InsightSection>
    );
    expect(screen.getByText("No region data.")).toBeInTheDocument();
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("puts labelId on the title so a list can be labelled by it", () => {
    render(
      <InsightSection title="By sport" ariaLabel="Sport breakdown" labelId="lbl" isEmpty={false}>
        <ul aria-labelledby="lbl">
          <li>row</li>
        </ul>
      </InsightSection>
    );
    expect(screen.getByRole("list", { name: "By sport" })).toBeInTheDocument();
  });
});
