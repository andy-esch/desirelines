import React from "react";
import { Goals, validateGoals, generateDefaultGoals } from "../utils/goalCalculations";
import { GOAL_COLORS } from "../constants/chartColors";
import type { MetricUnit } from "../utils/units";
import { useGoalManager } from "../hooks/useGoalManager";

interface GoalControlsProps {
  goals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  estimatedYearEnd: number;
  unit?: MetricUnit; // Unit label (e.g., "mi", "km", "sessions")
  sport?: string; // Sport name (e.g., "cycling", "running", "yoga")
  // Loading/error state from parent (useUserConfig hook)
  isSaving?: boolean;
  saveError?: Error | null;
  onClearSaveError?: () => void;
}

const GoalControls: React.FC<GoalControlsProps> = ({
  goals,
  onGoalsChange,
  estimatedYearEnd,
  unit = "miles", // Default to miles
  sport = "cycling", // Default to cycling
  isSaving = false,
  saveError = null,
  onClearSaveError,
}) => {
  const {
    editingId,
    setEditingId,
    editValue,
    setEditValue,
    editingLabel,
    setEditingLabel,
    editValidationError,
    setEditValidationError,
    handleStartEdit,
    handleSaveEdit,
    handleLabelEdit,
    handleLabelSave,
    handleIncrement,
    handleAddGoal,
    handleRemoveGoal,
    saveGoals,
    saveError: managerSaveError,
    clearSaveError: managerClearSaveError,
    incrementSize,
  } = useGoalManager({
    goals,
    onGoalsChange,
    estimatedYearEnd,
    sport,
  });

  const validation = validateGoals(goals);
  const effectiveSaveError = saveError || managerSaveError;
  const effectiveClearSaveError = () => {
    if (onClearSaveError) onClearSaveError();
    managerClearSaveError();
  };

  return (
    <div className="mb-3">
      <h6 className="text-muted">
        Desirelines ({goals.length}/5)
        {isSaving && (
          <span className="ms-2 text-muted small" aria-live="polite">
            Saving...
          </span>
        )}
      </h6>
      {effectiveSaveError && (
        <div className="alert alert-danger py-1 px-2 small" role="alert">
          {effectiveSaveError.message || "Failed to save. Please try again."}
          <button
            type="button"
            className="btn-close btn-sm float-end"
            aria-label="Dismiss"
            onClick={effectiveClearSaveError}
          />
        </div>
      )}
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
                disabled={isSaving}
              />
              {goals.length > 1 && (
                <button
                  className="btn btn-sm btn-link text-danger p-0 ms-2"
                  onClick={() => handleRemoveGoal(goal.id)}
                  title="Remove goal"
                  disabled={isSaving}
                >
                  ×
                </button>
              )}
            </div>

            <div className="input-group input-group-sm">
              <button
                className="btn btn-outline-secondary"
                onClick={() => handleIncrement(goal.id, -incrementSize)}
                disabled={goal.value <= 0 || isSaving}
              >
                −
              </button>
              {editingId === goal.id ? (
                <input
                  type="number"
                  className="form-control text-center"
                  value={editValue}
                  onChange={(e) => {
                    setEditValue(e.target.value);
                    setEditValidationError(null);
                  }}
                  onBlur={() => handleSaveEdit(goal.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit(goal.id);
                    if (e.key === "Escape") {
                      setEditingId(null);
                      setEditValidationError(null);
                    }
                  }}
                  autoFocus
                  disabled={isSaving}
                  style={{ maxWidth: "130px" }}
                  aria-describedby={editValidationError ? `goal-error-${goal.id}` : undefined}
                />
              ) : (
                <input
                  type="text"
                  className="form-control text-center"
                  value={`${goal.value.toLocaleString()} ${unit}`}
                  onFocus={() => handleStartEdit(goal.id, goal.value)}
                  readOnly
                  disabled={isSaving}
                  style={{ maxWidth: "130px", cursor: isSaving ? "not-allowed" : "pointer" }}
                />
              )}
              <button
                className="btn btn-outline-secondary"
                onClick={() => handleIncrement(goal.id, incrementSize)}
                disabled={isSaving}
              >
                +
              </button>
            </div>
            {editingId === goal.id && editValidationError && (
              <div
                id={`goal-error-${goal.id}`}
                className="alert alert-danger py-1 px-2 small mt-1"
                role="alert"
              >
                {editValidationError}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="d-grid gap-1">
        <button
          className="btn btn-sm btn-outline-slate"
          onClick={handleAddGoal}
          disabled={goals.length >= 5 || isSaving}
        >
          + Add Goal
        </button>
        <button
          className="btn btn-sm btn-ghost-slate d-inline-flex align-items-center justify-content-center gap-1"
          onClick={() => saveGoals(generateDefaultGoals(estimatedYearEnd))}
          disabled={isSaving}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Reset
        </button>
      </div>
    </div>
  );
};

export default GoalControls;
