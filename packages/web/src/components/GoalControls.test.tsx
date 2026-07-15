import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GoalControls from "./GoalControls";
import type { Goals } from "../utils/goalCalculations";
import type { SportConfig } from "../api/activities";
import { testGoals } from "../utils/goalTestFixtures";

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

      // Should still be in edit mode (input should be a number input)
      expect(editInput).toHaveAttribute("type", "number");
    });
  });

  describe("Goal Editing", () => {
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

  describe("Loading and Error States", () => {
    it("shows saving indicator when isSaving prop is true", () => {
      render(<GoalControls {...defaultProps} isSaving={true} />);

      // Should show saving indicator
      expect(screen.getByText("Saving...")).toBeInTheDocument();
    });

    it("hides saving indicator when isSaving prop is false", () => {
      render(<GoalControls {...defaultProps} isSaving={false} />);

      // Should not show saving indicator
      expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
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
});
