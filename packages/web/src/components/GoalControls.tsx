import React from "react";
import { type Goals, validateGoals, generateDefaultGoals } from "../utils/goalCalculations";
import { GOAL_COLORS } from "../constants/chartColors";
import { getMetricConfig } from "../config/metricConfig";
import type { MetricUnit } from "../utils/units";
import type { SportConfig } from "../api/activities";
import { useGoalManager } from "../hooks/useGoalManager";
import { InlineAlert } from "./InlineAlert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Alert } from "./ui/alert";
import { logApiError } from "../api/errors";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "./theme/useThemeStructure";

interface GoalControlsProps {
  goals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  estimatedYearEnd: number;
  /** Display unit label (e.g., "mi", "km", "sessions", "hours"). */
  unit: MetricUnit;
  /** Sport key (e.g., "cycling", "running", "yoga") — drives metric config lookup. */
  sport: string;
  /**
   * Sport's primary metric (e.g. "distance_meters"). Required so newly-added
   * and reset goals carry the correct `metric` from creation — see
   * harden-user-config-goal-data-integrity #2.
   */
  primaryMetric: string;
  /** Loaded sport registry (or null while loading) for metric-config lookup. */
  sportConfig: SportConfig | null;
  /**
   * The goals are suggestions (this year's pace, or the sport's floor), none saved yet. A note
   * says so, with a button to save them as they are; changing one saves them too.
   */
  suggested?: boolean | undefined;
  /** Save the suggested goals as they are. Required for the note's button. */
  onSaveSuggested?: (() => Promise<void>) | undefined;
  /**
   * The saved goals couldn't be loaded. A note says so, and nothing can be changed: a save
   * could put an edit or the suggestions over goals that are saved.
   */
  unavailable?: boolean | undefined;
  // Save state from the parent (the goals section hook, useGoals)
  isSaving?: boolean | undefined;
  saveError?: Error | null | undefined;
  onClearSaveError?: (() => void) | undefined;
}

const GoalControls: React.FC<GoalControlsProps> = ({
  goals,
  onGoalsChange,
  estimatedYearEnd,
  unit,
  sport,
  primaryMetric,
  sportConfig,
  suggested = false,
  onSaveSuggested,
  unavailable = false,
  isSaving = false,
  saveError = null,
  onClearSaveError,
}) => {
  const {
    editingId,
    editValue,
    setEditValue,
    editingLabel,
    setEditingLabel,
    editValidationError,
    setEditValidationError,
    handleStartEdit,
    handleSaveEdit,
    handleCancelEdit,
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
    primaryMetric,
    sportConfig,
  });

  const { stepperStyle, goalActionsStyle } = useThemeStructure();
  const boxed = stepperStyle === "box";
  const links = goalActionsStyle === "links";
  // The value between the − and +: joined to them by overlapping borders, or borderless
  // inside the stepper's box.
  const stepperField = boxed
    ? "h-auto min-w-0 rounded-none border-0 bg-transparent text-center text-xs shadow-none"
    : "mx-[min(0px,calc(var(--stepper-gap)_-_1px))] h-8 min-w-0 rounded-none text-center text-xs";

  // Set while Enter or Escape blurs the value field, so the blur doesn't save a second time
  // or save the entry Escape just dropped.
  const endingEditByKey = React.useRef(false);
  const blurEndingEdit = (field: HTMLInputElement) => {
    endingEditByKey.current = true;
    field.blur();
    endingEditByKey.current = false;
  };

  const validation = validateGoals(goals);
  // No change while a save is in flight, or while what's saved isn't known.
  const locked = isSaving || unavailable;
  const effectiveSaveError = saveError || managerSaveError;
  const effectiveClearSaveError = () => {
    if (onClearSaveError) onClearSaveError();
    managerClearSaveError();
  };

  return (
    <div className="mb-6">
      {/* A label, not a heading: the sidebar comes before the page's h1, and its "Goals"
          section toggle already names the area. */}
      <p className="text-muted-text">
        Desirelines ({goals.length}/5)
        {isSaving && (
          <span className="ms-2 text-muted-text text-sm" aria-live="polite">
            Saving…
          </span>
        )}
      </p>
      {effectiveSaveError && (
        <InlineAlert
          size="sm"
          onDismiss={onClearSaveError || managerSaveError ? effectiveClearSaveError : undefined}
        >
          {effectiveSaveError.message || "Failed to save. Please try again."}
        </InlineAlert>
      )}
      {unavailable && (
        <InlineAlert variant="warning" size="sm">
          Your saved goals couldn&apos;t be loaded, so they can&apos;t be changed right now. Reload
          to try again.
        </InlineAlert>
      )}
      {/* With the goals unknown there are none to validate. */}
      {!unavailable && !validation.valid && <InlineAlert size="sm">{validation.error}</InlineAlert>}
      {suggested && (
        <Alert className="mb-2 flex flex-col items-start gap-2 px-2 py-2 text-sm">
          <span>
            {/* The suggestions follow the pace only above the sport's floor, where the
                generator lifts a slower pace to the floor's goals. */}
            {estimatedYearEnd > getMetricConfig(sport, sportConfig).defaultGoalValue
              ? "Suggested from your pace so far."
              : "Suggested starting goals."}{" "}
            Save them, or change one to set your own.
          </span>
          {onSaveSuggested && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onSaveSuggested().catch((err: unknown) =>
                  logApiError(err, "[GoalControls] Failed to save the suggested goals")
                );
              }}
              disabled={locked}
            >
              Save these
            </Button>
          )}
        </Alert>
      )}

      <div className="mb-2 flex flex-col divide-y divide-surface-border border-y border-surface-border">
        {goals.map((goal, index) => {
          // Names each control for its goal, so a screen reader can tell one goal's apart
          // from another's; the saved label, not the one being typed, so it holds still.
          const name = goal.label || `Goal ${index + 1}`;
          const step = `${incrementSize.toLocaleString()} ${unit}`;
          return (
            <div
              key={goal.id}
              className="px-2 py-2"
              style={{ borderLeft: `4px solid ${GOAL_COLORS[index % GOAL_COLORS.length]}` }}
            >
              <div className="flex justify-between items-center mb-1">
                <Input
                  type="text"
                  className="h-8"
                  value={editingLabel?.id === goal.id ? editingLabel.value : goal.label || ""}
                  onChange={(e) => handleLabelEdit(goal.id, e.target.value)}
                  onBlur={() => handleLabelSave(goal.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLabelSave(goal.id);
                    if (e.key === "Escape") setEditingLabel(null);
                  }}
                  placeholder="Label"
                  aria-label={`${name} label`}
                  disabled={locked}
                />
                {goals.length > 1 && (
                  <Button
                    variant="link"
                    size="sm"
                    className="ms-2 h-auto p-0 text-danger"
                    onClick={() => handleRemoveGoal(goal.id)}
                    title="Remove goal"
                    aria-label={`Remove ${name}`}
                    disabled={locked}
                  >
                    ×
                  </Button>
                )}
              </div>

              {/* Per the theme's stepperStyle: outline buttons either side of the value, or one
                box in the control border with the − and + divided off inside it. As buttons,
                they form one joined group, or separate boxes where the theme sets a
                --stepper-gap; joined, the input overlaps its neighbours by a pixel so their
                borders merge. The − and + take the theme's --stepper-button-text, else the
                outline button's, and keep a plain edge where a theme rings its outline buttons.
                The box doesn't clip its contents, so a focus ring inside it stays whole. */}
              <div
                className={
                  boxed
                    ? "flex h-8 items-stretch rounded-(--control-radius) border border-input bg-card shadow-sm"
                    : "flex items-stretch gap-(--stepper-gap)"
                }
              >
                <Button
                  variant={boxed ? "ghost" : "outline"}
                  size="sm"
                  joined
                  className={cn(
                    boxed
                      ? "h-auto rounded-e-none rounded-s-[calc(var(--control-radius)-1px)] border-e border-divider"
                      : "rounded-e-none",
                    "text-[color:var(--stepper-button-text,var(--color-foreground))]"
                  )}
                  onClick={() => handleIncrement(goal.id, -incrementSize)}
                  disabled={goal.value <= 0 || locked}
                  aria-label={`Decrease ${name} by ${step}`}
                >
                  −
                </Button>
                {/* One field, shown formatted at rest and edited in place as a bare number, so
                  the tap that focuses it is the tap that raises a phone's keyboard: a
                  read-only field doesn't raise it, and iOS ignores a focus moved to a field
                  swapped in afterwards. `numeric` asks for the digit pad. Enter and Escape
                  blur the field, which closes the keyboard. */}
                <Input
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="done"
                  aria-label={`${name} value`}
                  className={stepperField}
                  value={
                    editingId === goal.id ? editValue : `${goal.value.toLocaleString()} ${unit}`
                  }
                  onFocus={() => {
                    if (editingId !== goal.id) handleStartEdit(goal.id, goal.value);
                  }}
                  onChange={(e) => {
                    setEditValue(e.target.value);
                    setEditValidationError(null);
                  }}
                  onBlur={() => {
                    if (!endingEditByKey.current && editingId === goal.id) handleSaveEdit(goal.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && handleSaveEdit(goal.id))
                      blurEndingEdit(e.currentTarget);
                    if (e.key === "Escape") {
                      handleCancelEdit();
                      blurEndingEdit(e.currentTarget);
                    }
                  }}
                  disabled={locked}
                  aria-describedby={
                    editingId === goal.id && editValidationError
                      ? `goal-error-${goal.id}`
                      : undefined
                  }
                  style={{ cursor: locked ? "not-allowed" : "pointer" }}
                />
                <Button
                  variant={boxed ? "ghost" : "outline"}
                  size="sm"
                  joined
                  className={cn(
                    boxed
                      ? "h-auto rounded-s-none rounded-e-[calc(var(--control-radius)-1px)] border-s border-divider"
                      : "rounded-s-none",
                    "text-[color:var(--stepper-button-text,var(--color-foreground))]"
                  )}
                  onClick={() => handleIncrement(goal.id, incrementSize)}
                  disabled={locked}
                  aria-label={`Increase ${name} by ${step}`}
                >
                  +
                </Button>
              </div>
              {editingId === goal.id && editValidationError && (
                <Alert
                  variant="danger"
                  id={`goal-error-${goal.id}`}
                  className="mt-1 px-2 py-1 text-sm"
                  role="alert"
                >
                  {editValidationError}
                </Alert>
              )}
            </div>
          );
        })}
      </div>

      {/* Per the theme's goalActionsStyle: a row of buttons, or text links at either end. */}
      <div className={links ? "flex items-center justify-between px-1" : "grid grid-cols-2 gap-2"}>
        <Button
          variant={links ? "link" : "outline"}
          size="sm"
          className={links ? "h-auto p-0" : undefined}
          onClick={handleAddGoal}
          disabled={goals.length >= 5 || locked}
        >
          + Add Goal
        </Button>
        <Button
          variant={links ? "link" : "ghost"}
          size="sm"
          className={cn("gap-1", links && "h-auto p-0 text-muted-text")}
          onClick={() => {
            // Use the sport's own roundingFactor + defaultGoalValue so reset
            // produces sport-appropriate buckets (running: 10/1000, yoga: 10/100,
            // cycling: 100/2500). Defaulting both to 100 here silently broke
            // reset for non-cycling sports — caught in PR review.
            const metricConfig = getMetricConfig(sport, sportConfig);
            void saveGoals(
              generateDefaultGoals({
                estimatedDistance: estimatedYearEnd,
                metric: primaryMetric,
                granularity: metricConfig.roundingFactor,
                minValue: metricConfig.defaultGoalValue,
              })
            );
          }}
          disabled={locked}
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
        </Button>
      </div>
    </div>
  );
};

export default GoalControls;
