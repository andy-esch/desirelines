import type { CSSProperties } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useThemeTokenValue } from "./useThemeTokenValue";
import { ThemeStructureProvider } from "./ThemeStructureProvider";
import { THEMES } from "../../themes/registry";

function Probe({ value }: { value?: string }) {
  const [ref, resolved] = useThemeTokenValue<HTMLDivElement>("--chart-bar-radius", "fallback");
  const style =
    value === undefined ? undefined : ({ "--chart-bar-radius": value } as CSSProperties);
  return (
    <div ref={ref} style={style} data-testid="probe">
      {resolved}
    </div>
  );
}

describe("useThemeTokenValue", () => {
  it("falls back where the token is not set", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("fallback");
  });

  it("reads the token on its own element, so a themed subtree gets its own value", () => {
    render(<Probe value="3px" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("3px");
  });

  it("reads again when the subtree switches theme", () => {
    const [first, second] = THEMES;
    const { rerender } = render(
      <ThemeStructureProvider structure={first.structure}>
        <Probe value="3px" />
      </ThemeStructureProvider>
    );
    rerender(
      <ThemeStructureProvider structure={second.structure}>
        <Probe value="0" />
      </ThemeStructureProvider>
    );
    expect(screen.getByTestId("probe")).toHaveTextContent(/^0$/);
  });
});
