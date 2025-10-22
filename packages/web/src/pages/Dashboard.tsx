import { useState, useMemo } from "react";
import Sidebar from "../components/layout/Sidebar";
import DistanceChart from "../components/charts/DistanceChartRecharts";
import PacingChart from "../components/charts/PacingChartRecharts";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "../utils/goalCalculations";
import { useDistanceData } from "../hooks/useDistanceData";
import { useUserConfig } from "../hooks/useUserConfig";
import type { GoalsForYear } from "../services/userConfigService";
import { GOAL_COLORS } from "../constants/chartColors";
import { calculateYearStats, calculateAveragePace } from "../utils/dateCalculations";
import { isActivityDataStale } from "../utils/activityStatus";
import {
  calculateTrainingMomentum,
  getMomentumLevel,
  type MomentumLevel,
} from "../utils/trainingMomentum";

export default function Dashboard() {
  const [currentYear, setCurrentYear] = useState(2025);
  const [showFullYear, setShowFullYear] = useState(true);

  const {
    distanceData,
    isLoading: distanceLoading,
    error: distanceError,
  } = useDistanceData(currentYear);

  const estimatedYearEnd = useMemo(() => {
    if (distanceData.length === 0) return 2500;
    return estimateYearEndDistance(distanceData, currentYear);
  }, [distanceData, currentYear]);

  const currentDistance = useMemo(() => {
    if (distanceData.length === 0) return 0;
    const lastEntry = distanceData[distanceData.length - 1];
    return lastEntry?.y || 0;
  }, [distanceData]);

  const defaultGoalsForYear: GoalsForYear = {
    goals: generateDefaultGoals(estimatedYearEnd || 2500).map((goal) => ({
      id: goal.id,
      value: goal.value,
      label: goal.label || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  };

  const {
    data: goalsData,
    loading: goalsLoading,
    error: goalsError,
    updateData: updateGoals,
  } = useUserConfig("goals", currentYear, defaultGoalsForYear);

  const goals = goalsData?.goals || [];

  const handleGoalsChange = async (newGoals: Goals) => {
    const updatedGoalsForYear: GoalsForYear = {
      goals: newGoals.map((goal) => ({
        id: goal.id,
        value: goal.value,
        label: goal.label || "",
        updatedAt: new Date().toISOString(),
        createdAt:
          goalsData?.goals?.find((g) => g.id === goal.id)?.createdAt || new Date().toISOString(),
      })),
    };
    await updateGoals(updatedGoalsForYear);
  };

  // Calculate stats for cards
  const yearStats = calculateYearStats(currentYear);
  const { daysElapsed, daysRemaining } = yearStats;
  const averagePace = calculateAveragePace(currentDistance, currentYear);

  // Smart "Next Goal" logic
  const nextGoal = useMemo(() => {
    if (goals.length === 0) return null;

    // Find first goal above current distance
    const goalsAbove = goals.filter((g) => g.value > currentDistance);
    if (goalsAbove.length > 0) {
      return goalsAbove[0];
    }

    // All goals passed - return the most recently passed (highest goal)
    return goals[goals.length - 1];
  }, [goals, currentDistance]);

  const nextGoalProgress = nextGoal ? (currentDistance / nextGoal.value) * 100 : 0;
  const nextGoalGap = nextGoal ? Math.max(0, nextGoal.value - currentDistance) : 0;

  // Pacing needed to reach next goal
  const paceNeededForNextGoal = daysRemaining > 0 && nextGoalGap > 0
    ? nextGoalGap / daysRemaining
    : 0;

  // Training momentum calculation: 14-day pacing slope
  const trainingMomentum = useMemo(
    () => calculateTrainingMomentum(distanceData, averagePace),
    [distanceData, averagePace]
  );

  // Check if activity data is stale (no recent activities)
  const isDataStale = useMemo(
    () => isActivityDataStale(distanceData),
    [distanceData]
  );

  // Categorize training momentum into 5 levels
  const momentumLevel: MomentumLevel = useMemo(
    () => getMomentumLevel(trainingMomentum, isDataStale),
    [trainingMomentum, isDataStale]
  );

  // Training momentum indicator renderer (simple style)
  const renderMomentumIndicator = () => {
    if (!momentumLevel) return null;

    const getSymbol = () => {
      if (momentumLevel === "stale") return "✕";
      if (momentumLevel === "significantly-up" || momentumLevel === "up") return "↑";
      if (momentumLevel === "steady") return "─";
      return "↓";
    };

    const getDescription = () => {
      if (momentumLevel === "stale") {
        return "Training Momentum: No recent activity\n\nNo activity recorded in the last 7 days. Momentum indicator is not available.";
      }

      if (trainingMomentum === null) return "";

      const sign = trainingMomentum >= 0 ? "+" : "";
      const percentage = `${sign}${trainingMomentum.toFixed(1)}%`;

      let trend = "";
      if (momentumLevel === "significantly-up") trend = "Significantly ramping up";
      else if (momentumLevel === "up") trend = "Ramping up";
      else if (momentumLevel === "steady") trend = "Steady pace";
      else if (momentumLevel === "down") trend = "Slightly declining";
      else if (momentumLevel === "significantly-down") trend = "Declining";

      return `Training Momentum: ${trend}\n${percentage} per week (14-day trend)\n\nShows whether your daily pace is accelerating, steady, or slowing down over the last 2 weeks.`;
    };

    return (
      <span
        style={{
          color: "#888",
          fontSize: "0.9em",
          marginLeft: "4px",
          cursor: "help",
          textDecoration: "underline dotted",
        }}
        title={getDescription()}
      >
        {getSymbol()}
      </span>
    );
  };

  return (
    <div className="container-fluid">
      <div className="row">
        <Sidebar
          currentYear={currentYear}
          onYearClick={setCurrentYear}
          goals={goals}
          onGoalsChange={handleGoalsChange}
          estimatedYearEnd={estimatedYearEnd}
          currentDistance={currentDistance}
        />

        <main className="col-md-9 ms-sm-auto col-lg-10 px-md-2 pt-3">
          {goalsLoading ? (
            <div className="text-center my-5">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading goals...</span>
              </div>
            </div>
          ) : goalsError ? (
            <div className="alert alert-danger" role="alert">
              Error loading goals: {goalsError.message}
            </div>
          ) : (
            <>
              {/* Key Stats Cards Row - Equal Heights */}
              <div className="row g-3 mb-4">
                <div className="col-md-4">
                  <div
                    className="card h-100"
                    style={{
                      transition: "transform 0.2s ease, box-shadow 0.2s ease",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-4px)";
                      e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "";
                    }}
                  >
                    <div className="card-body d-flex flex-column justify-content-between py-3">
                      <h6 className="card-subtitle mb-2 text-muted small">Current Distance</h6>
                      <div>
                        <h2 className="card-title mb-1">
                          {currentDistance.toFixed(0)} mi
                        </h2>
                        <small className="text-muted">
                          {averagePace.toFixed(1)} mi/day avg{renderMomentumIndicator()} · {daysElapsed} days
                        </small>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div
                    className="card h-100"
                    style={{
                      transition: "transform 0.2s ease, box-shadow 0.2s ease",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-4px)";
                      e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "";
                    }}
                  >
                    <div className="card-body d-flex flex-column justify-content-between py-3">
                      <h6 className="card-subtitle mb-2 text-muted small">
                        {nextGoal?.label || "Next Goal"}
                      </h6>
                      <div>
                        <h2 className="card-title mb-1">{nextGoalProgress.toFixed(0)}%</h2>
                        <small className="text-muted">
                          {nextGoalGap > 0
                            ? `${nextGoalGap.toFixed(0)} mi to ${nextGoal?.value.toLocaleString()}`
                            : nextGoal
                              ? `${nextGoal.value.toLocaleString()} mi reached!`
                              : "No goal set"}
                        </small>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div
                    className="card h-100"
                    style={{
                      transition: "transform 0.2s ease, box-shadow 0.2s ease",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-4px)";
                      e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "";
                    }}
                  >
                    <div className="card-body d-flex flex-column justify-content-between py-3">
                      <h6 className="card-subtitle mb-2 text-muted small">
                        Pace to {nextGoal?.label || "Goal"}
                      </h6>
                      <div>
                        <h2 className="card-title mb-1">
                          {paceNeededForNextGoal > 0 ? paceNeededForNextGoal.toFixed(1) : "—"}
                        </h2>
                        <small className="text-muted">
                          {paceNeededForNextGoal > 0
                            ? `mi/day · ${daysRemaining} days left`
                            : `${daysRemaining} days remaining`}
                        </small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Goal Achievability Table */}
              <div className="mb-4">
                <table className="table table-sm table-hover">
                  <thead className="table-light">
                    <tr>
                      <th colSpan={daysRemaining > 0 ? 6 : 5} className="bg-transparent border-0 pb-2">
                        <h6 className="mb-0 text-muted">Goal Achievability</h6>
                      </th>
                    </tr>
                    <tr>
                      <th style={{ width: "10px" }}></th>
                      <th>Goal</th>
                      <th>Target</th>
                      <th>Progress</th>
                      <th>Remaining</th>
                      {daysRemaining > 0 && <th>Daily Pace</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {goals.map((goal, index) => {
                      const progress = (currentDistance / goal.value) * 100;
                      const remaining = Math.max(0, goal.value - currentDistance);
                      const paceNeeded = daysRemaining > 0 ? remaining / daysRemaining : 0;
                      const goalColor = GOAL_COLORS[index % GOAL_COLORS.length];

                      return (
                        <tr key={goal.id}>
                          <td
                            style={{
                              borderLeft: `4px solid ${goalColor}`,
                              padding: "0",
                              width: "10px",
                            }}
                          ></td>
                          <td><strong>{goal.label || "Unnamed"}</strong></td>
                          <td>{goal.value.toLocaleString()} mi</td>
                          <td>
                            <div className="progress" style={{ height: "18px", minWidth: "80px" }}>
                              <div
                                className="progress-bar"
                                role="progressbar"
                                style={{
                                  width: `${Math.min(100, progress)}%`,
                                  backgroundColor: goalColor,
                                }}
                              >
                                <small>{progress.toFixed(0)}%</small>
                              </div>
                            </div>
                          </td>
                          <td>{remaining.toFixed(0)} mi</td>
                          {daysRemaining > 0 && <td>{paceNeeded.toFixed(1)} mi/day</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Chart Controls Bar */}
              <div className="d-flex justify-content-end align-items-center mb-2">
                {/* Chart View Toggle */}
                <div className="btn-group btn-group-sm" role="group" aria-label="Chart view options">
                  <input
                    type="radio"
                    className="btn-check"
                    name="chartView"
                    id="viewCurrent"
                    autoComplete="off"
                    checked={!showFullYear}
                    onChange={() => setShowFullYear(false)}
                  />
                  <label className="btn btn-outline-secondary" htmlFor="viewCurrent">
                    Current
                  </label>

                  <input
                    type="radio"
                    className="btn-check"
                    name="chartView"
                    id="viewFullYear"
                    autoComplete="off"
                    checked={showFullYear}
                    onChange={() => setShowFullYear(true)}
                  />
                  <label className="btn btn-outline-secondary" htmlFor="viewFullYear">
                    Full Year
                  </label>
                </div>
              </div>

              {/* Side-by-side Charts with Better Layout */}
              <div className="row g-1">
                <div className="col-lg-6">
                  <div className="card">
                    <div className="card-header bg-light">
                      <h6 className="mb-0 text-muted text-center">Cumulative Distance</h6>
                    </div>
                    <div className="card-body p-2">
                      <DistanceChart
                        year={currentYear}
                        goals={goals}
                        onGoalsChange={handleGoalsChange}
                        distanceData={distanceData}
                        isLoading={distanceLoading}
                        error={distanceError}
                        showFullYear={showFullYear}
                        hideHeader={true}
                      />
                    </div>
                  </div>
                </div>
                <div className="col-lg-6">
                  <div className="card">
                    <div className="card-header bg-light">
                      <h6 className="mb-0 text-muted text-center">Pacing Analysis</h6>
                    </div>
                    <div className="card-body p-2">
                      <PacingChart
                        year={currentYear}
                        goals={goals}
                        onGoalsChange={handleGoalsChange}
                        distanceData={distanceData}
                        isLoading={distanceLoading}
                        error={distanceError}
                        showFullYear={showFullYear}
                        hideHeader={true}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
