import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { type Goals, type Goal, buildGoal, validateGoalValue } from "../utils/goalCalculations";
import { getMetricConfig } from "../config/metricConfig";
import type { SportConfig } from "../api/activities";
import { logApiError } from "../api/errors";

interface UseGoalManagerProps {
  goals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  estimatedYearEnd: number;
  sport: string;
  /**
   * Sport's primary metric (e.g. "distance_meters"). Required so newly-added
   * goals carry the right `metric` from the moment of creation — closes the
   * "where does metric come from?" gap from issue #2 of
   * harden-user-config-goal-data-integrity.
   */
  primaryMetric: string;
  /** Loaded sport registry (or null while loading) for metric-config lookup. */
  sportConfig: SportConfig | null;
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
  primaryMetric,
  sportConfig,
}: UseGoalManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingLabel, setEditingLabel] = useState<{ id: string; value: string } | null>(null);
  const [editValidationError, setEditValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<Error | null>(null);

  // Debounce timers for label changes (per goal ID)
  const labelDebounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // The goals every edit builds on. A save reaches the `goals` rendered here a tick later
  // (the store updates its cache asynchronously), so an edit made in between would build
  // on goals missing the one before it, and save over it. Each save sets these at once;
  // the rendered goals take over again once no save is pending, which brings in a failed
  // save's rollback and changes from elsewhere.
  const latestGoals = useRef(goals);
  const renderedGoals = useRef(goals);
  const pendingSaves = useRef(0);
  useEffect(() => {
    renderedGoals.current = goals;
    if (pendingSaves.current === 0) latestGoals.current = goals;
  }, [goals]);

  /**
   * Clear any active save error
   */
  const clearSaveError = useCallback(() => {
    setSaveError(null);
  }, []);

  /**
   * Wrapper for onGoalsChange that handles errors.
   * Note: We do NOT clear pending label debounces here to allow parallel edits.
   */
  const saveGoals = async (updatedGoals: Goals) => {
    latestGoals.current = updatedGoals;
    pendingSaves.current += 1;
    try {
      setSaveError(null);
      await onGoalsChange(updatedGoals);
    } catch (err) {
      logApiError(err, "[useGoalManager] Failed to save goals");
      setSaveError(err instanceof Error ? err : new Error(String(err)));
      // What failed isn't saved: build on what's shown, which the store rolls back.
      latestGoals.current = renderedGoals.current;
    } finally {
      pendingSaves.current -= 1;
    }
  };

  // Get sport-specific configuration
  const metricConfig = useMemo(() => getMetricConfig(sport, sportConfig), [sport, sportConfig]);
  const incrementSize = metricConfig.goalIncrement;
  const roundingFactor = metricConfig.roundingFactor;

  const handleGoalValueChange = (id: string, value: number) => {
    // Round based on sport type (100 for cycling, 10 for running/yoga)
    const rounded = Math.round(value / roundingFactor) * roundingFactor;
    const now = new Date().toISOString();
    const updated = latestGoals.current.map((g) =>
      g.id === id ? { ...g, value: rounded, updatedAt: now } : g
    );
    void saveGoals(updated);
  };

  const handleIncrement = (id: string, delta: number) => {
    const goal = latestGoals.current.find((g) => g.id === id);
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
    const now = new Date().toISOString();
    const updated = latestGoals.current.map((g) =>
      g.id === id ? { ...g, value, updatedAt: now } : g
    );
    void saveGoals(updated);
    setEditingId(null);
    setEditValidationError(null);
  };

  const handleGoalLabelChange = (id: string, label: string) => {
    const now = new Date().toISOString();
    const updated = latestGoals.current.map((g) =>
      g.id === id ? { ...g, label, updatedAt: now } : g
    );
    void saveGoals(updated);
  };

  const handleLabelEdit = (id: string, value: string) => {
    setEditingLabel({ id, value });

    // Clear existing timer for this goal
    const existingTimer = labelDebounceTimers.current.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Debounce label save - only save after user stops typing for 500ms
    const timer = setTimeout(() => {
      handleGoalLabelChange(id, value);
      labelDebounceTimers.current.delete(id);
    }, 500);

    labelDebounceTimers.current.set(id, timer);
  };

  const handleLabelSave = (id: string) => {
    // Clear debounce timer for this goal
    const existingTimer = labelDebounceTimers.current.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      labelDebounceTimers.current.delete(id);
    }

    // Immediately save current value on blur
    if (editingLabel && editingLabel.id === id) {
      handleGoalLabelChange(id, editingLabel.value);
      setEditingLabel(null);
    }
  };

  const handleAddGoal = () => {
    const goals = latestGoals.current;
    if (goals.length >= 5) return;

    // Find unique value not in current goals
    let newValue = Math.ceil(estimatedYearEnd / roundingFactor) * roundingFactor;
    const existingValues = new Set(goals.map((g) => g.value));
    while (existingValues.has(newValue)) {
      newValue += incrementSize;
    }

    // Stamp full proto metadata at creation. Centralising this in buildGoal
    // (and threading `primaryMetric` as a prop) closes the "partial goal"
    // gap from harden-user-config-goal-data-integrity #2.
    const newGoal: Goal = buildGoal({
      id: Date.now().toString(),
      value: newValue,
      label: `Goal ${goals.length + 1}`,
      metric: primaryMetric,
    });
    void saveGoals([...goals, newGoal]);
  };

  const handleRemoveGoal = (id: string) => {
    const goals = latestGoals.current;
    if (goals.length <= 1) return;
    void saveGoals(goals.filter((g) => g.id !== id));
  };

  // Cleanup debounce timers on unmount
  useEffect(() => {
    const timers = labelDebounceTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
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
    saveError,
    clearSaveError,
    incrementSize, // Exposed for UI
  };
}
