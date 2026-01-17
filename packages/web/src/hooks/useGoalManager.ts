import { useState, useRef, useEffect, useMemo } from "react";
import { Goals, Goal, validateGoalValue } from "../utils/goalCalculations";
import { getMetricConfig } from "../config/metricConfig";

interface UseGoalManagerProps {
  goals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  estimatedYearEnd: number;
  sport: string;
}

/**
 * Hook for managing goal editing state and validation.
 *
 * Handles:
 * - Local state for editing values/labels
 * - Validation logic
 * - Debounced saving for labels
 * - Optimistic updates for values
 *
 * Separates UI logic from the presentation in GoalControls.
 */
export function useGoalManager({
  goals,
  onGoalsChange,
  estimatedYearEnd,
  sport,
}: UseGoalManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingLabel, setEditingLabel] = useState<{ id: string; value: string } | null>(null);
  const [editValidationError, setEditValidationError] = useState<string | null>(null);

  // Debounce timer for label changes
  const labelDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  /**
   * Wrapper for onGoalsChange that cancels pending debounced saves
   * to prevent race conditions.
   */
  const saveGoals = async (updatedGoals: Goals) => {
    // Cancel any pending debounced label save to prevent race condition
    if (labelDebounceTimer.current) {
      clearTimeout(labelDebounceTimer.current);
      labelDebounceTimer.current = null;
    }
    await onGoalsChange(updatedGoals);
  };

  // Get sport-specific configuration
  const metricConfig = useMemo(() => getMetricConfig(sport), [sport]);
  const incrementSize = metricConfig.goalIncrement;
  const roundingFactor = metricConfig.roundingFactor;

  const handleGoalValueChange = (id: string, value: number) => {
    // Round based on sport type (100 for cycling, 10 for running/yoga)
    const rounded = Math.round(value / roundingFactor) * roundingFactor;
    const updated = goals.map((g) => (g.id === id ? { ...g, value: rounded } : g));
    saveGoals(updated);
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
    setEditValidationError(null);
  };

  const handleSaveEdit = (id: string) => {
    const value = parseInt(editValue);
    if (isNaN(value)) {
      setEditingId(null);
      setEditValidationError(null);
      return;
    }

    // Validate the goal value (allows any positive integer)
    const validationError = validateGoalValue(value);
    if (validationError) {
      setEditValidationError(validationError);
      return;
    }

    // Don't round manual text entry - allow any positive integer
    const updated = goals.map((g) => (g.id === id ? { ...g, value } : g));
    saveGoals(updated);
    setEditingId(null);
    setEditValidationError(null);
  };

  const handleGoalLabelChange = (id: string, label: string) => {
    const updated = goals.map((g) => (g.id === id ? { ...g, label } : g));
    saveGoals(updated);
  };

  const handleLabelEdit = (id: string, value: string) => {
    setEditingLabel({ id, value });

    // Clear existing timer
    if (labelDebounceTimer.current) {
      clearTimeout(labelDebounceTimer.current);
    }

    // Debounce label save - only save after user stops typing for 500ms
    labelDebounceTimer.current = setTimeout(() => {
      handleGoalLabelChange(id, value);
    }, 500);
  };

  const handleLabelSave = (id: string) => {
    // Clear debounce timer
    if (labelDebounceTimer.current) {
      clearTimeout(labelDebounceTimer.current);
      labelDebounceTimer.current = null;
    }

    // Immediately save current value on blur
    if (editingLabel && editingLabel.id === id) {
      handleGoalLabelChange(id, editingLabel.value);
      setEditingLabel(null);
    }
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
    saveGoals([...goals, newGoal]);
  };

  const handleRemoveGoal = (id: string) => {
    if (goals.length <= 1) return;
    saveGoals(goals.filter((g) => g.id !== id));
  };

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (labelDebounceTimer.current) {
        clearTimeout(labelDebounceTimer.current);
      }
    };
  }, []);

  return {
    editingId,
    setEditingId, // Exposed for Escape key handling
    editValue,
    setEditValue,
    editingLabel,
    setEditingLabel, // Exposed for Escape key handling
    editValidationError,
    setEditValidationError, // Exposed for Escape key handling
    handleStartEdit,
    handleSaveEdit,
    handleLabelEdit,
    handleLabelSave,
    handleIncrement,
    handleAddGoal,
    handleRemoveGoal,
    saveGoals,
    incrementSize, // Exposed for UI
  };
}
