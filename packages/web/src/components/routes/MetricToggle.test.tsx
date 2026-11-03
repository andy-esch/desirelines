import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MetricToggle, type MetricOption } from "./MetricToggle";

type Metric = "distance" | "time";
const OPTIONS: readonly MetricOption<Metric>[] = [
  { value: "distance", label: "Distance" },
  { value: "time", label: "Time" },
];

/** A chart's header in miniature: the toggle drives its own state. */
function Harness({ onChange }: { onChange: (metric: Metric) => void }) {
  const [metric, setMetric] = useState<Metric>("distance");
  return (
    <MetricToggle
      options={OPTIONS}
      value={metric}
      onChange={(next) => {
        setMetric(next);
        onChange(next);
      }}
      ariaLabel="Weekly metric"
    />
  );
}

describe("MetricToggle", () => {
  it("renders one pressed button per option inside a labelled group", () => {
    render(<Harness onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Weekly metric" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Distance" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Time" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the chosen metric", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Time" }));
    expect(onChange).toHaveBeenCalledWith("time");
    expect(screen.getByRole("button", { name: "Time" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the pressed option when it is clicked again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Distance" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Distance" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
