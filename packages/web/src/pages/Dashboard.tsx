import { useState, useMemo, useCallback } from "react";
import Sidebar from "../components/layout/Sidebar";
import DistanceChart from "../components/charts/DistanceChartRecharts";
import PacingChart from "../components/charts/PacingChartRecharts";
import KPICards from "../components/dashboard/KPICards";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "../utils/goalCalculations";
import { useDistanceData } from "../hooks/useDistanceData";
import { useUserConfig } from "../hooks/useUserConfig";
import { useTrainingMomentum } from "../hooks/useTrainingMomentum";
import { useGoalStats } from "../hooks/useGoalStats";
import type { GoalsForYear } from "../services/userConfigService";
import { GOAL_COLORS } from "../constants/chartColors";
import { calculateYearStats, calculateAveragePace } from "../utils/dateCalculations";

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

  const handleGoalsChange = useCallback(
    async (newGoals: Goals) => {
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
    },
    [goalsData, updateGoals]
  );

  // Calculate stats for cards
  const yearStats = calculateYearStats(currentYear);
  const { daysElapsed, daysRemaining } = yearStats;
  const averagePace = calculateAveragePace(currentDistance, currentYear);

  // Custom hooks for complex calculations
  const { nextGoal, nextGoalProgress, nextGoalGap, paceNeededForNextGoal } = useGoalStats(
    goals,
    currentDistance,
    daysRemaining
  );

  const { momentumIndicator } = useTrainingMomentum(distanceData, averagePace);

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
              {/* Key Stats Cards Row */}
              <KPICards
                currentDistance={currentDistance}
                averagePace={averagePace}
                daysElapsed={daysElapsed}
                daysRemaining={daysRemaining}
                nextGoal={nextGoal}
                nextGoalProgress={nextGoalProgress}
                nextGoalGap={nextGoalGap}
                paceNeededForNextGoal={paceNeededForNextGoal}
                momentumIndicator={momentumIndicator}
              />

              {/* Goal Achievability Table */}
              <div className="mb-4">
                <table className="table table-sm table-hover">
                  <thead className="table-light">
                    <tr>
                      <th
                        colSpan={daysRemaining > 0 ? 6 : 5}
                        className="bg-transparent border-0 pb-2"
                      >
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
                          <td>
                            <strong>{goal.label || "Unnamed"}</strong>
                          </td>
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
                <div
                  className="btn-group btn-group-sm"
                  role="group"
                  aria-label="Chart view options"
                >
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
