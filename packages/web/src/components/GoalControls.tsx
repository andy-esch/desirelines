import React, { useState } from "react";
import { Goals, Goal, validateGoals, generateDefaultGoals } from "../utils/goalCalculations";
import { CHART_COLORS } from "../constants/chartColors";

interface GoalControlsProps {
  goals: Goals;
  onGoalsChange: (goals: Goals) => void;
  estimatedYearEnd: number;
  currentDistance: number;
}

const GoalControls: React.FC<GoalControlsProps> = ({
  goals,
  onGoalsChange,
  estimatedYearEnd,
  currentDistance,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const validation = validateGoals(goals);

  // Define colors matching chart goal lines (same as DistanceChart)
  const goalColors = [
    CHART_COLORS.LOWER_GOAL_LINE, // cyan
    CHART_COLORS.UPPER_GOAL_LINE, // magenta
    "rgb(100, 255, 100)", // green
    "rgb(255, 200, 0)", // orange
    "rgb(150, 100, 255)", // purple
  ];

  const handleGoalValueChange = (id: string, value: number) => {
    // Round to nearest 100
    const rounded = Math.round(value / 100) * 100;
    const updated = goals.map((g) => (g.id === id ? { ...g, value: rounded } : g));
    onGoalsChange(updated);
  };

  const handleIncrement = (id: string, delta: number) => {
    const goal = goals.find((g) => g.id === id);
    if (!goal) return;
    const newValue = Math.max(0, goal.value + delta);
    handleGoalValueChange(id, newValue);
  };

  const handleStartEdit = (id: string, currentValue: number) => {
    setEditingId(id);
    setEditValue(currentValue.toString());
  };

  const handleSaveEdit = (id: string) => {
    const value = parseInt(editValue);
    if (!isNaN(value) && value >= 0) {
      handleGoalValueChange(id, value);
    }
    setEditingId(null);
  };

  const handleGoalLabelChange = (id: string, label: string) => {
    const updated = goals.map((g) => (g.id === id ? { ...g, label } : g));
    onGoalsChange(updated);
  };

  const handleAddGoal = () => {
    if (goals.length >= 5) return;

    // Find unique value not in current goals
    let newValue = Math.ceil(estimatedYearEnd / 100) * 100;
    const existingValues = new Set(goals.map((g) => g.value));
    while (existingValues.has(newValue)) {
      newValue += 100;
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
            style={{ borderLeft: `4px solid ${goalColors[index % goalColors.length]}` }}
          >
            <div className="d-flex justify-content-between align-items-center mb-1">
              <input
                type="text"
                className="form-control form-control-sm"
                style={{ fontSize: "0.875rem" }}
                value={goal.label || ""}
                onChange={(e) => handleGoalLabelChange(goal.id, e.target.value)}
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
                onClick={() => handleIncrement(goal.id, -100)}
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
                  style={{ maxWidth: "80px" }}
                />
              ) : (
                <input
                  type="text"
                  className="form-control text-center"
                  value={`${goal.value.toLocaleString()} mi`}
                  onFocus={() => handleStartEdit(goal.id, goal.value)}
                  readOnly
                  style={{ maxWidth: "80px", cursor: "pointer" }}
                />
              )}
              <button
                className="btn btn-outline-secondary"
                onClick={() => handleIncrement(goal.id, 100)}
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
        <div>Current: {currentDistance.toFixed(0)} mi</div>
        <div>Est. Year-End: {estimatedYearEnd.toFixed(0)} mi</div>
      </div>
    </div>
  );
};

export default GoalControls;
