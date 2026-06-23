import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";
import { Badge } from "./badge";
import { Input } from "./input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";

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
