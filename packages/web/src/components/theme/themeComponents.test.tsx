import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { THEMES, type ThemeStructure } from "../../themes/registry";
import { ThemeStructureProvider } from "./ThemeStructureProvider";
import { useThemeStructure } from "./useThemeStructure";
import { Panel } from "./Panel";
import { Stat, StatRow } from "./Stat";
import { Meter } from "./Meter";
import { StatusSymbol } from "./StatusSymbol";
import { PageTitle } from "./PageTitle";
import { Section } from "./Section";
import { SportLabel, SportMark } from "./SportLabel";

const LEGACY = THEMES[0].structure;

function withStructure(overrides: Partial<ThemeStructure>, node: ReactNode) {
  return render(
    <ThemeStructureProvider structure={{ ...LEGACY, ...overrides }}>{node}</ThemeStructureProvider>
  );
}

describe("useThemeStructure", () => {
  function Probe() {
    return <span>{useThemeStructure().statRowStyle}</span>;
  }

  it("follows the active theme by default", () => {
    render(<Probe />);
    expect(screen.getByText(LEGACY.statRowStyle)).toBeInTheDocument();
  });

  it("lets a subtree render another structure", () => {
    withStructure({ statRowStyle: "boxed" }, <Probe />);
    expect(screen.getByText("boxed")).toBeInTheDocument();
  });
});

describe("Panel", () => {
  it("puts the title in a card header in Legacy themes", () => {
    const { container } = render(
      <Panel title="Goal achievability" meta="110 days left">
        body
      </Panel>
    );
    const panel = container.querySelector("section");
    expect(panel).toHaveAttribute("data-placement", "card-header");
    expect(panel).toContainElement(screen.getByRole("heading", { name: "Goal achievability" }));
  });

  it("puts the title above the frame for the above placement", () => {
    const { container } = withStructure(
      { sectionLabelPlacement: "above" },
      <Panel title="Recent activity">body</Panel>
    );
    const section = container.querySelector("section");
    expect(section).toHaveAttribute("data-placement", "above");
    const frame = screen.getByText("body").parentElement;
    expect(frame).not.toContainElement(screen.getByText("Recent activity"));
  });

  it("puts the title and meta in a header bar inside the frame", () => {
    const { container } = withStructure(
      { sectionLabelPlacement: "header-bar" },
      <Panel title="Latest activities" meta="PAGE 1/5">
        body
      </Panel>
    );
    const section = container.querySelector("section");
    expect(section).toHaveAttribute("data-placement", "header-bar");
    expect(section).toContainElement(screen.getByText("PAGE 1/5"));
  });

  it("renders no header without a title or meta", () => {
    const { container } = render(<Panel>body</Panel>);
    expect(container.querySelector("section")).toHaveAttribute("data-placement", "none");
  });

  it.each(["card-header", "above", "header-bar"] as const)(
    "keeps actions in the title row outside the body for the %s placement",
    (placement) => {
      withStructure(
        { sectionLabelPlacement: placement },
        <Panel title="Activity calendar" meta="227 activities" actions={<button>All</button>}>
          body
        </Panel>
      );
      const button = screen.getByRole("button", { name: "All" });
      const body = screen.getByText("body");
      expect(body).not.toContainElement(button);
      expect(screen.getByText("227 activities")).toBeInTheDocument();
    }
  );
});

describe("Section", () => {
  it("titles the section with a heading and shows its actions", () => {
    render(
      <Section title="Recent activity" actions={<button>2W</button>}>
        <p>content</p>
      </Section>
    );
    expect(screen.getByRole("heading", { level: 2, name: "Recent activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2W" })).toBeInTheDocument();
  });

  it("keeps the heading for label placements, with the meta inside it", () => {
    withStructure(
      { sectionLabelPlacement: "above" },
      <Section title="Activity calendar" meta="227 activities">
        <p>content</p>
      </Section>
    );
    const heading = screen.getByRole("heading", { level: 2, name: /Activity calendar/ });
    expect(heading).toContainElement(screen.getByText("227 activities"));
  });
});

describe("SportLabel", () => {
  it("shows the plain name where the theme uses badges and no badge is asked for", () => {
    const { container } = render(<SportLabel color="#ff00ff">Cycling</SportLabel>);
    expect(screen.getByText("Cycling")).toBeInTheDocument();
    expect(container.querySelector("[data-mark]")).not.toBeInTheDocument();
  });

  it("draws no standalone mark where the theme uses badges", () => {
    const { container } = render(<SportMark color="#ff00ff" />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["dot", "swatch"] as const)("marks the name with a %s", (style) => {
    const { container } = withStructure(
      { sportMarkStyle: style },
      <SportLabel color="#ff00ff">Cycling</SportLabel>
    );
    expect(container.querySelector(`[data-mark="${style}"]`)).toHaveTextContent("Cycling");
  });
});

describe("StatRow", () => {
  const stats = (
    <>
      <Stat label="Current distance" value="2,175" unit="mi" sub="8.5 mi/day avg" />
      <Stat label="Conservative" value="62%" accent={2} />
      <Stat label="Pace to conservative" value="12.0" unit="mi/day" emphasis />
    </>
  );

  it.each([
    ["cards", "card"],
    ["divided", "cell"],
    ["boxed", "box"],
  ] as const)("frames stats for the %s style", (style, frame) => {
    const { container } = withStructure({ statRowStyle: style }, <StatRow>{stats}</StatRow>);
    expect(container.querySelector(`[data-style="${style}"]`)).toBeInTheDocument();
    const frames = [...container.querySelectorAll("[data-frame]")].map((el) =>
      el.getAttribute("data-frame")
    );
    expect(frames).toEqual([frame, frame, frame]);
  });

  it("frames a lone stat as a card", () => {
    const { container } = render(<Stat label="Current distance" value="2,175" />);
    expect(container.querySelector("[data-frame]")).toHaveAttribute("data-frame", "card");
    expect(screen.getByText("Current distance")).toBeInTheDocument();
  });
});

describe("Meter", () => {
  const dayOfYear = 256 / 365;

  function segmentsOf(container: HTMLElement) {
    return [...container.querySelectorAll("[data-segment]")].map((el) =>
      el.getAttribute("data-segment")
    );
  }

  it("splits a year into done, current and remaining months", () => {
    const { container } = render(<Meter value={dayOfYear} segments={12} label="Year progress" />);
    expect(segmentsOf(container)).toEqual([
      ...Array(8).fill("done"),
      "current",
      ...Array(3).fill("todo"),
    ]);
    expect(screen.getByRole("progressbar", { name: "Year progress" })).toHaveAttribute(
      "aria-valuenow",
      "70"
    );
  });

  it("fills the current segment to its share when the theme asks for it", () => {
    const { container } = withStructure(
      { meterPartialCurrent: true },
      <Meter value={dayOfYear} segments={12} label="Year progress" />
    );
    const current = container.querySelector('[data-segment="current"] > span') as HTMLElement;
    expect(current.style.width).toBe("42%");
  });

  it("fills the whole current segment otherwise", () => {
    const { container } = render(<Meter value={dayOfYear} segments={12} label="Year progress" />);
    const current = container.querySelector('[data-segment="current"] > span') as HTMLElement;
    expect(current.style.width).toBe("100%");
  });

  it("clamps values and marks everything done at 100%", () => {
    const { container } = render(<Meter value={1.4} segments={4} label="Done" />);
    expect(segmentsOf(container)).toEqual(["done", "done", "done", "done"]);
  });

  it("announces no value while indeterminate", () => {
    const { container } = render(
      <Meter value={0} segments={8} label="Loading activities" indeterminate />
    );
    const bar = screen.getByRole("progressbar", { name: "Loading activities" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-busy", "true");
    expect(segmentsOf(container)).toEqual(Array(8).fill("chase"));
  });

  it("draws a continuous track with a fill, a marker and, in Legacy themes, the percent", () => {
    const { container } = render(
      <Meter
        value={0.62}
        marker={dayOfYear}
        color="rgb(0, 255, 255)"
        label="Conservative progress"
      />
    );
    expect(container.querySelector('[data-meter="continuous"]')).toBeInTheDocument();
    expect((container.querySelector("[data-marker]") as HTMLElement).style.left).toMatch(/^70\.1/);
    expect(screen.getByText("62%")).toBeInTheDocument();
  });

  it("leaves the percent off for track styles", () => {
    withStructure(
      { goalTrackStyle: "track" },
      <Meter value={0.62} label="Conservative progress" />
    );
    expect(screen.queryByText("62%")).not.toBeInTheDocument();
  });
});

describe("PageTitle", () => {
  it("renders only the heading where the theme hides kickers", () => {
    withStructure({ showPageKicker: false }, <PageTitle kicker="About">Origins</PageTitle>);
    expect(screen.getByRole("heading", { level: 1, name: "Origins" })).toBeInTheDocument();
    expect(screen.queryByText("About")).not.toBeInTheDocument();
  });

  it("renders the kicker above the heading where the theme shows kickers", () => {
    withStructure({ showPageKicker: true }, <PageTitle kicker="About">Origins</PageTitle>);
    const heading = screen.getByRole("heading", { level: 1, name: "Origins" });
    const kicker = screen.getByText("About");
    expect(kicker.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("StatusSymbol", () => {
  it("renders a badge in Legacy themes, keeping the caller's fill", () => {
    render(
      <StatusSymbol
        status="behind"
        label="Behind"
        badgeStyle={{ backgroundColor: "rgb(255, 0, 255)" }}
      />
    );
    const badge = screen.getByText("Behind");
    expect(badge).toHaveAttribute("data-status", "behind");
    expect(badge).toHaveStyle({ backgroundColor: "rgb(255, 0, 255)" });
    expect(badge.querySelector("svg")).toBeNull();
  });

  it("shows badge content in badges and the label with symbols", () => {
    const { unmount } = render(
      <StatusSymbol status="ahead" label="145% of goal" badgeContent="145%" />
    );
    expect(screen.getByText("145%")).toHaveAttribute("data-status", "ahead");
    unmount();
    withStructure(
      { statusSymbolStyle: "filled" },
      <StatusSymbol status="ahead" label="145% of goal" badgeContent="145%" />
    );
    expect(screen.getByText("145% of goal")).toBeInTheDocument();
  });

  it.each(["filled", "outlined"] as const)(
    "renders a symbol plus text in the %s style",
    (style) => {
      const { container } = withStructure(
        { statusSymbolStyle: style },
        <StatusSymbol status="slightly-behind" label="Slightly behind" />
      );
      const status = container.querySelector('[data-status="slightly-behind"]');
      expect(status).toHaveTextContent("Slightly behind");
      expect(status?.querySelector("svg")).not.toBeNull();
      expect(status).not.toHaveClass("text-on-accent");
    }
  );

  it("shows text without a symbol for no activity", () => {
    const { container } = withStructure(
      { statusSymbolStyle: "filled" },
      <StatusSymbol status="no-activity" label="No activity" />
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("No activity")).toBeInTheDocument();
  });
});
