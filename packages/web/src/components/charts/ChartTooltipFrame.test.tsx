import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { THEMES, type ThemeStructure } from "../../themes/registry";
import { ThemeStructureProvider } from "../theme/ThemeStructureProvider";
import ChartTooltipFrame, { type ChartTooltipFrameProps } from "./ChartTooltipFrame";

const structureOf = (id: string): ThemeStructure => THEMES.find((t) => t.id === id)!.structure;

function frame(header: ThemeStructure["tooltipHeader"], props: Partial<ChartTooltipFrameProps>) {
  return render(
    <ThemeStructureProvider structure={{ ...structureOf("miami"), tooltipHeader: header }}>
      <ChartTooltipFrame title="Aug 2026" {...props}>
        <div>Cycling 25h</div>
      </ChartTooltipFrame>
    </ThemeStructureProvider>
  );
}

const DIVIDER = "1px solid var(--color-chart-tooltip-divider)";

/**
 * An element's inline style rules, as written. jsdom's computed style drops a border
 * shorthand that holds a `var()`, so `toHaveStyle` can't see these.
 */
const rulesOf = (el: Element | null | undefined) =>
  (el?.getAttribute("style") ?? "")
    .split(";")
    .map((rule) => rule.trim())
    .filter(Boolean);
const ACCENT = "var(--color-chart-tooltip-accent)";

describe("ChartTooltipFrame", () => {
  it("draws the tooltip surface, border, corner, shadow and font around the rows", () => {
    frame("inline", {});
    const box = screen.getByText("Cycling 25h").closest("div[style*='--tooltip-shadow']");
    expect(rulesOf(box)).toEqual(
      expect.arrayContaining([
        "background-color: var(--color-chart-tooltip-bg)",
        "border: 1px solid var(--color-chart-tooltip-border)",
        "border-radius: var(--tooltip-radius)",
        "box-shadow: var(--tooltip-shadow)",
        "font-family: var(--font-chart)",
      ])
    );
  });

  describe("an inline title", () => {
    it("rules a heading off from the rows", () => {
      frame("inline", { tone: "heading" });
      expect(rulesOf(screen.getByText("Aug 2026"))).toEqual(
        expect.arrayContaining([
          "color: var(--color-chart-tooltip-text)",
          "font-weight: 700",
          `border-bottom: ${DIVIDER}`,
        ])
      );
    });

    it("sets a caption in the muted color, without a rule", () => {
      frame("inline", { tone: "caption" });
      const rules = rulesOf(screen.getByText("Aug 2026"));
      expect(rules).toContain("color: var(--color-chart-tooltip-muted)");
      expect(rules.filter((rule) => rule.startsWith("border"))).toEqual([]);
    });
  });

  describe("a header bar", () => {
    it.each(["heading", "caption"] as const)(
      "draws a %s as a bar in the accent, ruled off in it",
      (tone) => {
        frame("bar", { tone });
        const title = screen.getByText("Aug 2026");
        expect(rulesOf(title)).toEqual(
          expect.arrayContaining([
            `color: ${ACCENT}`,
            `border-bottom: 1px solid ${ACCENT}`,
            "padding: 6px 10px",
          ])
        );
        expect(title).toHaveClass("[text-transform:var(--label-case)]");
      }
    );

    it("is Arcade's, and Miami's and Electric's titles stay inline", () => {
      expect(THEMES.map((t) => [t.id, t.structure.tooltipHeader])).toEqual([
        ["miami", "inline"],
        ["arcade", "bar"],
        ["electric", "inline"],
      ]);
    });
  });

  describe("the total", () => {
    it("closes the rows with the total in the accent", () => {
      frame("inline", { total: { label: "Total", value: "45h" } });
      expect(screen.getByText("45h")).toHaveStyle({ color: ACCENT });
      expect(rulesOf(screen.getByText("Total").parentElement)).toContain(`border-top: ${DIVIDER}`);
    });

    it("labels it in the label color and case under a header bar", () => {
      frame("bar", { total: { label: "Total", value: "45h" } });
      const label = screen.getByText("Total");
      expect(label).toHaveStyle({ color: "var(--color-chart-tooltip-label)" });
      expect(label).toHaveClass("[text-transform:var(--label-case)]");
      expect(screen.getByText("45h")).toHaveStyle({ color: ACCENT });
    });

    it("draws no total row without one", () => {
      frame("inline", {});
      expect(screen.queryByText("Total")).not.toBeInTheDocument();
    });
  });
});
