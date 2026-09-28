import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsSection } from "./SettingsSection";

function renderSection(defaultExpanded = true) {
  return render(
    <SettingsSection
      title="Display"
      description="Customize how data is displayed throughout the app"
      defaultExpanded={defaultExpanded}
    >
      <p>Theme picker</p>
    </SettingsSection>
  );
}

describe("SettingsSection", () => {
  it("titles the section with a heading that holds its collapse button", () => {
    renderSection();
    const heading = screen.getByRole("heading", { level: 2, name: "Display" });
    const button = screen.getByRole("button", { name: "Display", expanded: true });
    expect(heading).toContainElement(button);
    expect(button).toHaveAccessibleDescription(
      "Customize how data is displayed throughout the app"
    );
  });

  it("names the region it controls after the title", () => {
    renderSection();
    const region = screen.getByRole("region", { name: "Display" });
    expect(screen.getByRole("button", { name: "Display" })).toHaveAttribute(
      "aria-controls",
      region.id
    );
    expect(region).toContainElement(screen.getByText("Theme picker"));
  });

  it("collapses and expands from the button, by click or keyboard", async () => {
    const user = userEvent.setup();
    renderSection();
    const button = screen.getByRole("button", { name: "Display" });
    const region = screen.getByRole("region", { name: "Display" });

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(region).toHaveStyle({ height: "0px" });

    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("starts collapsed when asked", () => {
    renderSection(false);
    expect(screen.getByRole("button", { name: "Display" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
