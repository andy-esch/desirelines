import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GoalControls from "./GoalControls";
import type { Goals } from "../utils/goalCalculations";

describe("GoalControls", () => {
  const mockGoals: Goals = [
    { id: "1", value: 1000, label: "Base" },
    { id: "2", value: 2000, label: "Target" },
  ];

  const defaultProps = {
    goals: mockGoals,
    onGoalsChange: vi.fn(),
    estimatedYearEnd: 2500,
    currentDistance: 1500,
    unit: "miles" as const,
    sport: "cycling",
  };

  describe("Inline Validation", () => {
    it("displays inline error when invalid value is entered", () => {
      render(<GoalControls {...defaultProps} />);

      // Click on first goal to edit
      const goalInput = screen.getAllByRole("textbox")[1]; // Skip label input
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
      const goalInput = screen.getAllByRole("textbox")[1];
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

      const goalInput = screen.getAllByRole("textbox")[1];
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

      const goalInput = screen.getAllByRole("textbox")[1];
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

      const goalInput = screen.getAllByRole("textbox")[1];
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

      const goalInput = screen.getAllByRole("textbox")[1];
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

      const goalInput = screen.getAllByRole("textbox")[1];
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

      const goalInput = screen.getAllByRole("textbox")[1];
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      fireEvent.change(editInput, { target: { value: "1300" } });
      fireEvent.keyDown(editInput, { key: "Enter" });

      expect(defaultProps.onGoalsChange).toHaveBeenCalled();
    });

    it("cancels edit on Escape key", () => {
      const onGoalsChange = vi.fn();

      render(<GoalControls {...defaultProps} onGoalsChange={onGoalsChange} />);

      const goalInput = screen.getAllByRole("textbox")[1];
      fireEvent.focus(goalInput);

      const editInput = screen.getByDisplayValue("1000");

      fireEvent.change(editInput, { target: { value: "1400" } });
      fireEvent.keyDown(editInput, { key: "Escape" });

      // Should not save changes
      expect(onGoalsChange).not.toHaveBeenCalled();
    });
  });
});
