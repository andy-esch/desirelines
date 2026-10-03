import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GoalControls from "./GoalControls";
import type { Goals } from "../utils/goalCalculations";
import type { SportConfig } from "../api/activities";
import { testGoals } from "../utils/goalTestFixtures";
import { THEMES, type ThemeStructure } from "../themes/registry";
import { ThemeStructureProvider } from "./theme/ThemeStructureProvider";

describe("GoalControls", () => {
  const mockGoals: Goals = testGoals([
    { id: "1", value: 1000, label: "Base" },
    { id: "2", value: 2000, label: "Target" },
  ]);

  // Minimal registry fixture so getMetricConfig resolves sport-specific goal
  // tuning (running: rounding 10 / default 1000; cycling: base 100 / 2500).
  const testSportConfig: SportConfig = {
    version: "1.0",
    sportCategories: {
      cycling: {
        displayName: "Cycling",
        stravaTypes: [],
        excludedTypes: [],
        primaryMetric: "distance_meters",
        metrics: [],
        hasDistance: true,
        hasElevation: false,
      },
      running: {
        displayName: "Running",
        stravaTypes: [],
        excludedTypes: [],
        primaryMetric: "distance_meters",
        metrics: [],
        hasDistance: true,
        hasElevation: false,
        goalDefaults: { increment: 10, rounding: 10, defaultValue: 1000 },
      },
    },
  };

  // Create async mock that resolves immediately by default
  const createAsyncMock = () => vi.fn().mockResolvedValue(undefined);

  const defaultProps = {
    goals: mockGoals,
    onGoalsChange: createAsyncMock(),
    estimatedYearEnd: 2500,
    currentDistance: 1500,
    unit: "miles" as const,
    sport: "cycling",
    primaryMetric: "distance_meters",
    sportConfig: testSportConfig,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onGoalsChange = createAsyncMock();
  });

  describe("Inline Validation", () => {
    it("displays inline error when invalid value is entered", () => {
      render(<GoalControls {...defaultProps} />);

      // Click on first goal to edit
      const goalInput = screen.getAllByRole("textbox")[1]!; // Skip label input
      fireEvent.focus(goalInput);

      // Input should now be editable
      const editInput = screen.getByDisplayValue("1000");

      // Enter invalid value (negative)
      fireEvent.change(editInput, { target: { value: "-100" } });
      fireEvent.blur(editInput);

      // Should show inline error message
      expect(screen.getByRole("alert")).toHaveTextContent("Goal must be greater than 0");
    });

    it("clears error when user starts typing", () => {
      render(<GoalControls {...defaultProps} />);

      // Enter edit mode
      const goalInput = screen.getAllByRole("textbox")[1]!;
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      // Enter invalid value
      fireEvent.change(editInput, { target: { value: "-100" } });
      fireEvent.blur(editInput);

      // Error should appear
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // Start typing again
      fireEvent.focus(goalInput);
      fireEvent.change(editInput, { target: { value: "1500" } });

      // Error should be cleared
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("clears error when user presses Escape", () => {
      render(<GoalControls {...defaultProps} />);

      const goalInput = screen.getAllByRole("textbox")[1]!;
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      // Enter invalid value
      fireEvent.change(editInput, { target: { value: "-100" } });
      fireEvent.blur(editInput);

      // Error should appear
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // Press Escape
      fireEvent.focus(goalInput);
      fireEvent.keyDown(editInput, { key: "Escape" });

      // Error should be cleared and input should exit edit mode
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not call alert() for validation errors", () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

      render(<GoalControls {...defaultProps} />);

      const goalInput = screen.getAllByRole("textbox")[1]!;
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      // Enter invalid value
      fireEvent.change(editInput, { target: { value: "0" } });
      fireEvent.blur(editInput);

      // Should NOT have called alert()
      expect(alertSpy).not.toHaveBeenCalled();

      // Should show inline error instead
      expect(screen.getByRole("alert")).toBeInTheDocument();

      alertSpy.mockRestore();
    });

    it("accepts valid values without showing error", () => {
      render(<GoalControls {...defaultProps} />);

      const goalInput = screen.getAllByRole("textbox")[1]!;
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      // Enter valid value
      fireEvent.change(editInput, { target: { value: "1500" } });
      fireEvent.blur(editInput);

      // Should not show error
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Should call onGoalsChange
      expect(defaultProps.onGoalsChange).toHaveBeenCalled();
    });

    it("keeps error visible and stays in edit mode when validation fails", () => {
      render(<GoalControls {...defaultProps} />);

      const goalInput = screen.getAllByRole("textbox")[1]!;
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      // Enter invalid value
      fireEvent.change(editInput, { target: { value: "-100" } });
      fireEvent.blur(editInput);

      // Error should be visible
      const errorAlert = screen.getByRole("alert");
      expect(errorAlert).toBeInTheDocument();

      // Still editing: the field keeps the entry rather than going back to the saved value
      expect(editInput).toHaveValue("-100");
    });
  });

  describe("Goal Editing", () => {
    // These focus the field for real, so the blur that Enter and Escape cause runs too.
    const valueField = () => screen.getByRole("textbox", { name: "Base value" });

    it("edits the value in place, in the field that was tapped, with a digit keyboard", async () => {
      render(<GoalControls {...defaultProps} />);
      const field = valueField();
      expect(field).toHaveValue("1,000 miles");
      expect(field).toHaveAttribute("inputmode", "numeric");
      expect(field).toHaveAttribute("enterkeyhint", "done");
      expect(field).not.toHaveAttribute("readonly");

      await userEvent.click(field);

      // The same element, focused and showing the bare number: no second field takes over.
      expect(field).toHaveFocus();
      expect(field).toHaveValue("1000");
    });

    it("saves once on Enter and leaves the field, closing the keyboard", async () => {
      render(<GoalControls {...defaultProps} />);
      const field = valueField();

      await userEvent.click(field);
      await userEvent.clear(field);
      await userEvent.type(field, "1300{Enter}");

      expect(defaultProps.onGoalsChange).toHaveBeenCalledTimes(1);
      const saved = vi.mocked(defaultProps.onGoalsChange).mock.calls[0]![0] as Goals;
      expect(saved.find((g) => g.id === "1")?.value).toBe(1300);
      expect(field).not.toHaveFocus();
    });

    it("drops the entry on Escape, and leaving the field afterwards saves nothing", async () => {
      render(<GoalControls {...defaultProps} />);
      const field = valueField();

      await userEvent.click(field);
      await userEvent.clear(field);
      await userEvent.type(field, "1400{Escape}");
      await userEvent.tab();

      expect(defaultProps.onGoalsChange).not.toHaveBeenCalled();
      expect(field).toHaveValue("1,000 miles");
    });

    it("saves nothing when the field is left unchanged", async () => {
      render(<GoalControls {...defaultProps} />);

      await userEvent.click(valueField());
      await userEvent.tab();

      expect(defaultProps.onGoalsChange).not.toHaveBeenCalled();
    });

    it("draws the stepper's − and + in the theme's stepper text, else the outline button's", () => {
      render(<GoalControls {...defaultProps} />);

      const steppers = [
        ...screen.getAllByRole("button", { name: "−" }),
        ...screen.getAllByRole("button", { name: "+" }),
      ];
      expect(steppers).toHaveLength(4);
      for (const button of steppers) {
        expect(button.className.split(/\s+/)).toContain(
          "text-[color:var(--stepper-button-text,var(--color-foreground))]"
        );
      }
    });

    it("allows editing goal values", () => {
      render(<GoalControls {...defaultProps} />);

      const goalInput = screen.getAllByRole("textbox")[1]!;
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      fireEvent.change(editInput, { target: { value: "1200" } });
      fireEvent.blur(editInput);

      expect(defaultProps.onGoalsChange).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "1", value: 1200 })])
      );
    });

    it("saves on Enter key", () => {
      render(<GoalControls {...defaultProps} />);

      const goalInput = screen.getAllByRole("textbox")[1]!;
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      fireEvent.change(editInput, { target: { value: "1300" } });
      fireEvent.keyDown(editInput, { key: "Enter" });

      expect(defaultProps.onGoalsChange).toHaveBeenCalled();
    });

    it("cancels edit on Escape key", () => {
      const onGoalsChange = createAsyncMock();

      render(<GoalControls {...defaultProps} onGoalsChange={onGoalsChange} />);

      const goalInput = screen.getAllByRole("textbox")[1]!;
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      fireEvent.change(editInput, { target: { value: "1400" } });
      fireEvent.keyDown(editInput, { key: "Escape" });

      // Should not save changes
      expect(onGoalsChange).not.toHaveBeenCalled();
    });
  });

  it("labels the goal count without adding a heading ahead of the page's h1", () => {
    render(<GoalControls {...defaultProps} />);

    expect(screen.getByText(/^Desirelines \(\d\/5\)/)).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  describe("Loading and Error States", () => {
    it("shows saving indicator when isSaving prop is true", () => {
      render(<GoalControls {...defaultProps} isSaving={true} />);

      // Should show saving indicator
      expect(screen.getByText("Saving…")).toBeInTheDocument();
    });

    it("hides saving indicator when isSaving prop is false", () => {
      render(<GoalControls {...defaultProps} isSaving={false} />);

      // Should not show saving indicator
      expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    });

    it("disables inputs when isSaving prop is true", () => {
      render(<GoalControls {...defaultProps} isSaving={true} />);

      // All buttons should be disabled
      const allButtons = screen.getAllByRole("button");
      allButtons.forEach((button) => {
        expect(button).toBeDisabled();
      });
    });

    it("shows error message when saveError prop is set", () => {
      const saveError = new Error("Network error");
      render(<GoalControls {...defaultProps} saveError={saveError} />);

      // Should show error message
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    it("shows default error message when saveError has no message", () => {
      const saveError = new Error();
      render(<GoalControls {...defaultProps} saveError={saveError} />);

      // Should show default error message
      expect(screen.getByText("Failed to save. Please try again.")).toBeInTheDocument();
    });

    it("allows dismissing error message via onClearSaveError", () => {
      const saveError = new Error("Network error");
      const onClearSaveError = vi.fn();

      render(
        <GoalControls {...defaultProps} saveError={saveError} onClearSaveError={onClearSaveError} />
      );

      // Error should be visible
      expect(screen.getByText("Network error")).toBeInTheDocument();

      // Dismiss error
      const dismissButton = screen.getByLabelText("Dismiss");
      fireEvent.click(dismissButton);

      // onClearSaveError should be called
      expect(onClearSaveError).toHaveBeenCalled();
    });

    it("does not show dismiss button when onClearSaveError is not provided", () => {
      const saveError = new Error("Network error");

      render(<GoalControls {...defaultProps} saveError={saveError} />);

      // Error should be visible
      expect(screen.getByText("Network error")).toBeInTheDocument();

      // Dismiss button should not be present
      expect(screen.queryByLabelText("Dismiss")).not.toBeInTheDocument();
    });
  });

  describe("Reset button", () => {
    // Pin sport-specific reset behavior. Earlier code defaulted granularity to
    // 100 for every sport, which produced cycling-shaped goals (e.g. 2400/2500/2600)
    // even on running and yoga. The fix routes through getMetricConfig(sport).
    it("produces running-shaped goals when reset on a running page", () => {
      const onGoalsChange = createAsyncMock();
      render(
        <GoalControls
          {...defaultProps}
          sport="running"
          primaryMetric="distance_meters"
          estimatedYearEnd={0}
          onGoalsChange={onGoalsChange}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /reset/i }));

      // Running config: roundingFactor=10, defaultGoalValue=1000.
      // Expect: Conservative 990, Target 1000, Stretch 1010.
      const saved = onGoalsChange.mock.calls[0]![0] as Goals;
      expect(saved.map((g) => g.value)).toEqual([990, 1000, 1010]);
      saved.forEach((goal) => {
        expect(goal.metric).toBe("distance_meters");
        expect(goal.createdAt).toEqual(expect.any(String));
      });
    });

    it("produces cycling-shaped goals when reset on a cycling page", () => {
      const onGoalsChange = createAsyncMock();
      render(
        <GoalControls
          {...defaultProps}
          sport="cycling"
          estimatedYearEnd={0}
          onGoalsChange={onGoalsChange}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /reset/i }));

      // Cycling config: roundingFactor=100, defaultGoalValue=2500.
      // Expect: Conservative 2400, Target 2500, Stretch 2600.
      const saved = onGoalsChange.mock.calls[0]![0] as Goals;
      expect(saved.map((g) => g.value)).toEqual([2400, 2500, 2600]);
    });
  });

  describe("suggested goals", () => {
    const NOTE = "Suggested from your pace so far. Save them, or change one to set your own.";

    it("calls them starting goals where the pace is below the sport's floor", () => {
      // Cycling's floor is 2,500 mi: a slower pace gets the floor's goals, not its own.
      render(
        <GoalControls
          {...defaultProps}
          estimatedYearEnd={1800}
          suggested
          onSaveSuggested={createAsyncMock()}
        />
      );
      expect(
        screen.getByText("Suggested starting goals. Save them, or change one to set your own.")
      ).toBeInTheDocument();
    });

    it("says the goals follow the pace and saves them as they are", () => {
      const onSaveSuggested = createAsyncMock();
      // Cycling's floor is 2,500 mi, so a pace for 3,000 is what the suggestions follow.
      render(
        <GoalControls
          {...defaultProps}
          estimatedYearEnd={3000}
          suggested
          onSaveSuggested={onSaveSuggested}
        />
      );

      expect(screen.getByText(NOTE)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Save these" }));
      expect(onSaveSuggested).toHaveBeenCalledOnce();
      expect(defaultProps.onGoalsChange).not.toHaveBeenCalled();
    });

    it("says nothing once goals are saved", () => {
      render(<GoalControls {...defaultProps} onSaveSuggested={createAsyncMock()} />);
      expect(screen.queryByText(NOTE)).toBeNull();
      expect(screen.queryByRole("button", { name: "Save these" })).toBeNull();
    });

    it("can't be saved twice while a save is in flight", () => {
      render(
        <GoalControls {...defaultProps} suggested onSaveSuggested={createAsyncMock()} isSaving />
      );
      expect(screen.getByRole("button", { name: "Save these" })).toBeDisabled();
    });

    it("says the saved goals couldn't be loaded, and allows no change", () => {
      render(<GoalControls {...defaultProps} goals={[]} unavailable />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your saved goals couldn't be loaded, so they can't be changed right now."
      );
      expect(screen.getByRole("button", { name: "+ Add Goal" })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Reset/ })).toBeDisabled();
    });
  });

  describe("theme structure", () => {
    const renderIn = (overrides: Partial<ThemeStructure>) =>
      render(
        <ThemeStructureProvider structure={{ ...THEMES[0].structure, ...overrides }}>
          <GoalControls {...defaultProps} />
        </ThemeStructureProvider>
      );
    const firstMinus = () => screen.getAllByRole("button", { name: "−" })[0]!;

    it("draws a stepper as outline buttons around its value, gapped by the theme", () => {
      renderIn({ stepperStyle: "buttons" });
      expect(firstMinus().className).toContain("border-(color:--button-outline-border-color)");
      expect(firstMinus().parentElement!.className).toContain("gap-(--stepper-gap)");
    });

    it("draws a stepper as one control box, the − and + divided off inside it", () => {
      renderIn({ stepperStyle: "box" });
      const minus = firstMinus();
      expect(minus.parentElement!.className).toContain("border-input");
      expect(minus.className).toContain("border-divider");
      expect(minus.className).not.toContain("--button-outline-border-color");
      // The value sits borderless inside the box; the label field comes first.
      expect(screen.getAllByRole("textbox")[1]!.className).toContain("border-0");
    });

    it("steps the goal the same way in the box", () => {
      renderIn({ stepperStyle: "box" });
      fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]!);
      expect(defaultProps.onGoalsChange).toHaveBeenCalledTimes(1);
    });

    it("draws adding and resetting as buttons, or as text links", () => {
      const look = (goalActionsStyle: ThemeStructure["goalActionsStyle"]) => {
        const { unmount } = renderIn({ goalActionsStyle });
        const classes = [
          screen.getByRole("button", { name: "+ Add Goal" }).className,
          screen.getByRole("button", { name: /Reset/ }).className,
        ];
        unmount();
        return classes;
      };
      const [addButton, resetButton] = look("buttons");
      expect(addButton).toContain("border-(color:--button-outline-border-color)");
      expect(resetButton).not.toContain("underline-offset-4");
      for (const link of look("links")) expect(link).toContain("underline-offset-4");
    });
  });
});
