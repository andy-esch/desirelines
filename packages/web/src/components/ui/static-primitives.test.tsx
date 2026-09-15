import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";
import { Badge } from "./badge";
import { Input } from "./input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";
import { Alert } from "./alert";
import { Table } from "./table";
import { SportBadge } from "../SportBadge";

describe("Button", () => {
  it("renders children and fires onClick", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Reset</Button>);

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant + size classes via cva", () => {
    render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toContain("bg-destructive");
    expect(btn.className).toContain("h-8");
  });

  it.each([
    ["outline-danger", "text-danger"],
    ["outline-success", "text-success"],
    ["outline-warning", "text-warning"],
  ] as const)("draws the %s variant as an outline in its status color", (variant, text) => {
    render(<Button variant={variant}>Retry</Button>);
    const btn = screen.getByRole("button", { name: "Retry" });
    expect(btn.className).toContain("bg-transparent");
    expect(btn.className).toContain(text);
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>
    );

    await user.click(screen.getByRole("button", { name: "Nope" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Badge", () => {
  it("renders with the default and outline variants", () => {
    const { rerender } = render(<Badge>New</Badge>);
    expect(screen.getByText("New").className).toContain("bg-primary");

    rerender(<Badge variant="outline">Tag</Badge>);
    expect(screen.getByText("Tag").className).toContain("border-border");
  });
});

describe("Input", () => {
  it("accepts typed text", async () => {
    const user = userEvent.setup();
    render(<Input placeholder="Search" />);
    const input = screen.getByPlaceholderText("Search");

    await user.type(input, "alps");
    expect(input).toHaveValue("alps");
  });

  it("is non-interactive when disabled", async () => {
    const user = userEvent.setup();
    render(<Input placeholder="Search" disabled />);
    const input = screen.getByPlaceholderText("Search");

    await user.type(input, "x");
    expect(input).toHaveValue("");
    expect(input).toBeDisabled();
  });
});

describe("Card", () => {
  it("composes header/title/description/content/footer", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Totals</CardTitle>
          <CardDescription>This year</CardDescription>
        </CardHeader>
        <CardContent>1,234 km</CardContent>
        <CardFooter>footer</CardFooter>
      </Card>
    );

    expect(screen.getByText("Totals")).toBeInTheDocument();
    expect(screen.getByText("This year")).toBeInTheDocument();
    expect(screen.getByText("1,234 km")).toBeInTheDocument();
    expect(screen.getByText("footer")).toBeInTheDocument();
  });
});

describe("Alert", () => {
  it.each([
    ["danger", "text-danger"],
    ["warning", "text-warning"],
    ["success", "text-success"],
    ["info", "text-body-text"],
    ["demo", "text-subtle-text"],
  ] as const)("tints the %s variant", (variant, text) => {
    render(
      <Alert variant={variant} role="alert">
        Message
      </Alert>
    );
    expect(screen.getByRole("alert")).toHaveClass(text);
  });

  it("leaves the role to the caller", () => {
    render(<Alert>Quiet note</Alert>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Table", () => {
  it("marks hover tables so rows highlight", () => {
    const { container, rerender } = render(
      <Table hover>
        <tbody>
          <tr>
            <td>Row</td>
          </tr>
        </tbody>
      </Table>
    );
    expect(container.querySelector("table")).toHaveAttribute("data-hover");
    rerender(
      <Table>
        <tbody>
          <tr>
            <td>Row</td>
          </tr>
        </tbody>
      </Table>
    );
    expect(container.querySelector("table")).not.toHaveAttribute("data-hover");
  });
});

describe("SportBadge", () => {
  it("shows the label and carries the sport color for its dot and hairline", () => {
    render(<SportBadge color="rgb(0, 255, 255)">cycling</SportBadge>);
    const badge = screen.getByText("cycling");
    expect(badge.style.getPropertyValue("--sport-color")).toBe("rgb(0, 255, 255)");
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("Badge compact size", () => {
  it("draws a small solid pill in the caller's fill", () => {
    render(
      <Badge variant="solid" size="compact" style={{ backgroundColor: "rgb(255, 0, 255)" }}>
        Behind
      </Badge>
    );
    const badge = screen.getByText("Behind");
    expect(badge).toHaveClass("text-on-accent", "rounded-sm");
    expect(badge).toHaveStyle({ backgroundColor: "rgb(255, 0, 255)" });
  });
});
