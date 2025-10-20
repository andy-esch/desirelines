import { useState, useMemo } from "react";
import "./App.css";
import "bootstrap/dist/css/bootstrap.css";
import "./css/dashboard.css";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import DistanceChart from "./components/charts/DistanceChartRecharts";
import PacingChart from "./components/charts/PacingChartRecharts";
import GoalSummaryTable from "./components/GoalSummaryTable";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "./utils/goalCalculations";
import { useDistanceData } from "./hooks/useDistanceData";
import { useUserConfig } from "./hooks/useUserConfig";
import type { GoalsForYear } from "./services/userConfigService";

function App() {
  const [currentYear, setCurrentYear] = useState(2025);

  // Fetch distance data using custom hook (consolidates data fetching)
  const {
    distanceData,
    isLoading: distanceLoading,
    error: distanceError,
  } = useDistanceData(currentYear);

  // Derive estimated year-end distance from data
  const estimatedYearEnd = useMemo(() => {
    if (distanceData.length === 0) return 2500; // Default when no data
    return estimateYearEndDistance(distanceData, currentYear);
  }, [distanceData, currentYear]);

  // Derive current distance from data
  const currentDistance = useMemo(() => {
    if (distanceData.length === 0) return 0;
    const lastEntry = distanceData[distanceData.length - 1];
    return lastEntry?.y || 0;
  }, [distanceData]);

  // Generate default GoalsForYear structure
  const defaultGoalsForYear: GoalsForYear = {
    goals: generateDefaultGoals(estimatedYearEnd || 2500).map((goal) => ({
      id: goal.id,
      value: goal.value,
      label: goal.label || "", // Ensure label is always a string
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  };

  // Use Firestore-persisted goals with useUserConfig hook
  const {
    data: goalsData,
    loading: goalsLoading,
    error: goalsError,
    updateData: updateGoals,
  } = useUserConfig("goals", currentYear, defaultGoalsForYear);

  // Extract goals array from GoalsForYear structure
  const goals = goalsData?.goals || [];

  // Wrapper to update goals (converts from Goals[] to GoalsForYear)
  const handleGoalsChange = async (newGoals: Goals) => {
    const updatedGoalsForYear: GoalsForYear = {
      goals: newGoals.map((goal) => ({
        id: goal.id,
        value: goal.value,
        label: goal.label || "", // Ensure label is always a string
        updatedAt: new Date().toISOString(),
        // Preserve createdAt if it exists, otherwise set it
        createdAt:
          goalsData?.goals?.find((g) => g.id === goal.id)?.createdAt || new Date().toISOString(),
      })),
    };
    await updateGoals(updatedGoalsForYear);
  };

  return (
    <div className="App">
      <Header />
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

          <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
            <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
              <h1 className="h2">Desirelines as of {new Date().toDateString()}</h1>
            </div>

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
                <DistanceChart
                  year={currentYear}
                  goals={goals}
                  onGoalsChange={handleGoalsChange}
                  distanceData={distanceData}
                  isLoading={distanceLoading}
                  error={distanceError}
                />
                <PacingChart
                  year={currentYear}
                  goals={goals}
                  onGoalsChange={handleGoalsChange}
                  distanceData={distanceData}
                  isLoading={distanceLoading}
                  error={distanceError}
                />
                <GoalSummaryTable
                  goals={goals}
                  currentDistance={currentDistance}
                  year={currentYear}
                />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
