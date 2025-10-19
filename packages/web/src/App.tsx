import { useState, useEffect } from "react";
import "./App.css";
import "bootstrap/dist/css/bootstrap.css";
import "./css/dashboard.css";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import DistanceChart from "./components/charts/DistanceChart";
import PacingChart from "./components/charts/PacingChart";
import GoalSummaryTable from "./components/GoalSummaryTable";
import {
  generateDefaultGoals,
  estimateYearEndDistance,
  type Goals,
} from "./utils/goalCalculations";
import { fetchDistanceData } from "./api/activities";
import { useUserConfig } from "./hooks/useUserConfig";
import type { GoalsForYear } from "./services/userConfigService";

function App() {
  const [currentYear, setCurrentYear] = useState(2025);
  const [estimatedYearEnd, setEstimatedYearEnd] = useState(0);
  const [currentDistance, setCurrentDistance] = useState(0);

  // Fetch distance data to calculate default goals
  useEffect(() => {
    const loadData = async () => {
      try {
        const rideData = await fetchDistanceData(currentYear);
        if (rideData.distance_traveled && rideData.distance_traveled.length > 0) {
          const lastEntry = rideData.distance_traveled[rideData.distance_traveled.length - 1];
          setCurrentDistance(lastEntry?.y || 0);

          const estimated = estimateYearEndDistance(rideData.distance_traveled, currentYear);
          setEstimatedYearEnd(estimated);
        } else {
          // No data yet, use reasonable defaults
          setCurrentDistance(0);
          setEstimatedYearEnd(2500);
        }
      } catch (err) {
        console.error("Failed to fetch ride data:", err);
        // Error fetching data, use reasonable defaults
        setCurrentDistance(0);
        setEstimatedYearEnd(2500);
      }
    };

    loadData();
  }, [currentYear]);

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
                <DistanceChart year={currentYear} goals={goals} onGoalsChange={handleGoalsChange} />
                <PacingChart year={currentYear} goals={goals} onGoalsChange={handleGoalsChange} />
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
