import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SportFilterPills from "./SportFilterPills";

const OPTIONS = [
  { value: "cycling", label: "Cycling" },
  { value: "running", label: "Running" },
  { value: "yoga", label: "Yoga" },
];

function renderPills({ visibleSports = ["cycling", "running"], selected = [] as string[] } = {}) {
  const onChange = vi.fn();
  render(
    <>
      <span id="sports-label">Sports</span>
      <SportFilterPills
        sportOptions={OPTIONS}
        visibleSports={visibleSports}
        selected={selected}
        onChange={onChange}
        labelledBy="sports-label"
      />
    </>
  );
  return { onChange };
}

const chipNames = () => screen.getAllByRole("button").map((chip) => chip.textContent);

describe("SportFilterPills", () => {
  it("shows the tracked sports, not every option", () => {
    renderPills();
    expect(chipNames()).toEqual(["Cycling", "Running"]);
  });

  it("adds a selected option the athlete does not track", () => {
    renderPills({ selected: ["yoga"] });
    expect(chipNames()).toEqual(["Cycling", "Running", "Yoga"]);
  });

  it("gives a selected sport missing from the options a pressed chip under its raw key", () => {
    renderPills({ selected: ["hiking"] });
    expect(chipNames()).toEqual(["Cycling", "Running", "hiking"]);
    expect(screen.getByRole("button", { name: "hiking" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets that chip be deselected", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPills({ selected: ["cycling", "hiking"] });
    await user.click(screen.getByRole("button", { name: "hiking" }));
    expect(onChange).toHaveBeenCalledWith(["cycling"]);
  });
});
