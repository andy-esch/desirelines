import React, { useState } from "react";
import {
  Goals,
  Goal,
  validateGoals,
  validateGoalValue,
  generateDefaultGoals,
} from "../utils/goalCalculations";
import { GOAL_COLORS } from "../constants/chartColors";
import type { MetricUnit } from "../utils/units";

interface GoalControlsProps {
  goals: Goals;
  onGoalsChange: (goals: Goals) => void;
  estimatedYearEnd: number;
  currentDistance: number;
  unit?: MetricUnit; // Unit label (e.g., "mi", "km", "sessions")
  sport?: string; // Sport name (e.g., "cycling", "running", "yoga")
  isLoading?: boolean; // Whether data is still loading
}

const GoalControls: React.FC<GoalControlsProps> = ({
  goals,
  onGoalsChange,
  estimatedYearEnd,
  currentDistance,
  unit = "miles", // Default to miles
  sport = "cycling", // Default to cycling
  isLoading = false,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingLabel, setEditingLabel] = useState<{ id: string; value: string } | null>(null);

  const validation = validateGoals(goals);

  // Determine increment size based on sport type
  // Cycling: 100, Running: 10, Yoga: 10
  const incrementSize = sport === "cycling" ? 100 : 10;
  const roundingFactor = sport === "cycling" ? 100 : 10;

  const handleGoalValueChange = (id: string, value: number) => {
    // Round based on sport type (100 for cycling, 10 for running/yoga)
    const rounded = Math.round(value / roundingFactor) * roundingFactor;
    const updated = goals.map((g) => (g.id === id ? { ...g, value: rounded } : g));
    onGoalsChange(updated);
  };

  const handleIncrement = (id: string, delta: number) => {
    const goal = goals.find((g) => g.id === id);
    if (!goal) return;
    const newValue = Math.max(incrementSize, goal.value + delta); // Prevent going below minimum
    handleGoalValueChange(id, newValue);
  };

  const handleStartEdit = (id: string, currentValue: number) => {
    setEditingId(id);
    setEditValue(currentValue.toString());
  };

  const handleSaveEdit = (id: string) => {
    const value = parseInt(editValue);
    if (isNaN(value)) {
      setEditingId(null);
      return;
    }

    // Validate the goal value (allows any positive integer)
    const validationError = validateGoalValue(value);
    if (validationError) {
      // Show error (keep editing mode open)
      alert(validationError);
      return;
    }

    // Don't round manual text entry - allow any positive integer
    const updated = goals.map((g) => (g.id === id ? { ...g, value } : g));
    onGoalsChange(updated);
    setEditingId(null);
  };

  const handleLabelEdit = (id: string, value: string) => {
    setEditingLabel({ id, value });
  };

  const handleLabelSave = (id: string) => {
    if (editingLabel && editingLabel.id === id) {
      handleGoalLabelChange(id, editingLabel.value);
      setEditingLabel(null);
    }
  };

  const handleGoalLabelChange = (id: string, label: string) => {
    const updated = goals.map((g) => (g.id === id ? { ...g, label } : g));
    onGoalsChange(updated);
  };

  const handleAddGoal = () => {
    if (goals.length >= 5) return;

    // Find unique value not in current goals
    let newValue = Math.ceil(estimatedYearEnd / roundingFactor) * roundingFactor;
    const existingValues = new Set(goals.map((g) => g.value));
    while (existingValues.has(newValue)) {
      newValue += incrementSize;
    }

    const newGoal: Goal = {
      id: Date.now().toString(),
      value: newValue,
      label: `Goal ${goals.length + 1}`,
    };
    onGoalsChange([...goals, newGoal]);
  };

  const handleRemoveGoal = (id: string) => {
    if (goals.length <= 1) return;
    onGoalsChange(goals.filter((g) => g.id !== id));
  };

  return (
    <div className="mb-3">
      <h6 className="text-muted">Desirelines ({goals.length}/5)</h6>
      {!validation.valid && (
        <div className="alert alert-danger py-1 px-2 small">{validation.error}</div>
      )}

      <div className="list-group list-group-flush mb-2">
        {goals.map((goal, index) => (
          <div
            key={goal.id}
            className="list-group-item px-2 py-2"
            style={{ borderLeft: `4px solid ${GOAL_COLORS[index % GOAL_COLORS.length]}` }}
          >
            <div className="d-flex justify-content-between align-items-center mb-1">
              <input
                type="text"
                className="form-control form-control-sm"
                style={{ fontSize: "0.875rem" }}
                value={editingLabel?.id === goal.id ? editingLabel.value : goal.label || ""}
                onChange={(e) => handleLabelEdit(goal.id, e.target.value)}
                onBlur={() => handleLabelSave(goal.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLabelSave(goal.id);
                  if (e.key === "Escape") setEditingLabel(null);
                }}
                placeholder="Label"
              />
              {goals.length > 1 && (
                <button
                  className="btn btn-sm btn-link text-danger p-0 ms-2"
                  onClick={() => handleRemoveGoal(goal.id)}
                  title="Remove goal"
                >
                  ×
                </button>
              )}
            </div>

            <div className="input-group input-group-sm">
              <button
                className="btn btn-outline-secondary"
                onClick={() => handleIncrement(goal.id, -incrementSize)}
                disabled={goal.value <= 0}
              >
                −
              </button>
              {editingId === goal.id ? (
                <input
                  type="number"
                  className="form-control text-center"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => handleSaveEdit(goal.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit(goal.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                  style={{ maxWidth: "130px" }}
                />
              ) : (
                <input
                  type="text"
                  className="form-control text-center"
                  value={`${goal.value.toLocaleString()} ${unit}`}
                  onFocus={() => handleStartEdit(goal.id, goal.value)}
                  readOnly
                  style={{ maxWidth: "130px", cursor: "pointer" }}
                />
              )}
              <button
                className="btn btn-outline-secondary"
                onClick={() => handleIncrement(goal.id, incrementSize)}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="d-grid gap-1">
        <button
          className="btn btn-sm btn-outline-primary"
          onClick={handleAddGoal}
          disabled={goals.length >= 5}
        >
          + Add Goal
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => onGoalsChange(generateDefaultGoals(estimatedYearEnd))}
        >
          Reset
        </button>
      </div>

      <div className="mt-2 small text-muted">
        <div>
          Current:{" "}
          {isLoading
            ? "--"
            : currentDistance === 0
              ? "--"
              : `${currentDistance.toFixed(0)} ${unit}`}
        </div>
        <div>
          Est. Year-End:{" "}
          {isLoading
            ? "--"
            : estimatedYearEnd === 0
              ? "--"
              : `${estimatedYearEnd.toFixed(0)} ${unit}`}
        </div>
      </div>
    </div>
  );
};

export default GoalControls;
