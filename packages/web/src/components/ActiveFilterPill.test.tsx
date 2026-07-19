import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActiveFilterPill, { activeFilterLabels } from "./ActiveFilterPill";

const TIME = [
  { value: "2w", label: "2 Weeks" },
  { value: "ytd", label: "Year to Date" },
];
const SPORTS = [
  { value: "", label: "All Sports" },
  { value: "cycling", label: "Cycling" },
];

describe("activeFilterLabels", () => {
  it("returns nothing when range is the default and no sport is set", () => {
    expect(activeFilterLabels("ytd", "ytd", "", TIME, SPORTS)).toEqual([]);
  });

  it("includes the range label when the range differs from the default", () => {
    expect(activeFilterLabels("2w", "ytd", "", TIME, SPORTS)).toEqual(["2 Weeks"]);
  });

  it("includes the sport label when a sport is selected", () => {
    expect(activeFilterLabels("ytd", "ytd", "cycling", TIME, SPORTS)).toEqual(["Cycling"]);
  });

  it("includes both, range before sport", () => {
    expect(activeFilterLabels("2w", "ytd", "cycling", TIME, SPORTS)).toEqual([
      "2 Weeks",
      "Cycling",
    ]);
  });
});

describe("ActiveFilterPill", () => {
  it("renders nothing when there are no active filters", () => {
    const { container } = render(<ActiveFilterPill filters={[]} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active-filter summary and clears on demand", async () => {
    const onClear = vi.fn();
    render(<ActiveFilterPill filters={["6 Months", "Cycling"]} onClear={onClear} />);
    expect(document.body.textContent).toContain("6 Months");
    expect(document.body.textContent).toContain("Cycling");
    await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
