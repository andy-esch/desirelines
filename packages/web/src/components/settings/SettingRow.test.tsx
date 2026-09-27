import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingRow } from "./SettingRow";

describe("SettingRow", () => {
  it("labels a single control with <label for>", () => {
    render(
      <SettingRow label="Distance Unit" description="Used for all distance measurements">
        {(descriptionId, inputId) => <input id={inputId} aria-describedby={descriptionId} />}
      </SettingRow>
    );
    const input = screen.getByRole("textbox", { name: "Distance Unit" });
    expect(input).toHaveAccessibleDescription("Used for all distance measurements");
  });

  it("names a group by id, since <label for> can't name one", () => {
    render(
      <SettingRow label="Theme" description="Saved on this device" group>
        {(descriptionId, _inputId, labelId) => (
          <div role="radiogroup" aria-labelledby={labelId} aria-describedby={descriptionId} />
        )}
      </SettingRow>
    );
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toHaveAccessibleDescription("Saved on this device");
    expect(screen.getByText("Theme").tagName).not.toBe("LABEL");
  });
});
