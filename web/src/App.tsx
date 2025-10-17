import { useState, useEffect } from "react";
import "./App.css";
import "bootstrap/dist/css/bootstrap.css";
import "./css/dashboard.css";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import DistanceChart from "./components/charts/DistanceChart";
import PacingChart from "./components/charts/PacingChart";
import GoalSummaryTable from "./components/GoalSummaryTable";
import { generateDefaultGoals, estimateYearEndDistance, type Goals } from "./utils/goalCalculations";
import { fetchDistanceData } from "./api/activities";

function App() {
  const [currentYear, setCurrentYear] = useState(2025);
  const [goals, setGoals] = useState<Goals>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [estimatedYearEnd, setEstimatedYearEnd] = useState(0);
  const [currentDistance, setCurrentDistance] = useState(0);

  const handleYearClick = (year: number) => {
    setCurrentYear(year);
    setIsInitializing(true); // Reset when year changes
  };

  // Custom goals persistence: save to localStorage whenever goals change
  useEffect(() => {
    if (goals.length > 0 && !isInitializing) {
      const key = `desirelines_goals_${currentYear}`;
      localStorage.setItem(key, JSON.stringify(goals));
    }
  }, [goals, currentYear, isInitializing]);

  // Fetch distance data and load/calculate goals
  useEffect(() => {
    const loadData = async () => {
      // Try to load goals from localStorage for this year
      const storageKey = `desirelines_goals_${currentYear}`;
      const storedGoals = localStorage.getItem(storageKey);
      let loadedGoals: Goals | null = null;

      if (storedGoals) {
        try {
          loadedGoals = JSON.parse(storedGoals);
        } catch (e) {
          console.error('Failed to parse stored goals:', e);
        }
      }

      try {
        const rideData = await fetchDistanceData(currentYear);
        if (rideData.distance_traveled && rideData.distance_traveled.length > 0) {
          const lastEntry = rideData.distance_traveled[rideData.distance_traveled.length - 1];
          const currentDist = lastEntry?.y || 0;
          setCurrentDistance(currentDist);

          const estimated = estimateYearEndDistance(rideData.distance_traveled, currentYear);
          setEstimatedYearEnd(estimated);

          // Use stored goals if available, otherwise generate defaults
          if (loadedGoals && loadedGoals.length > 0) {
            setGoals(loadedGoals);
          } else {
            const defaultGoals = generateDefaultGoals(estimated);
            setGoals(defaultGoals);
          }
        } else {
          // No data yet, use reasonable defaults
          setCurrentDistance(0);
          setEstimatedYearEnd(2500);
          setGoals(loadedGoals && loadedGoals.length > 0 ? loadedGoals : generateDefaultGoals(2500));
        }
      } catch (err) {
        // Error fetching data, use reasonable defaults
        setCurrentDistance(0);
        setEstimatedYearEnd(2500);
        setGoals(loadedGoals && loadedGoals.length > 0 ? loadedGoals : generateDefaultGoals(2500));
      } finally {
        setIsInitializing(false);
      }
    };

    loadData();
  }, [currentYear]);

  return (
    <div className="App">
      <Header />
      <div className="container-fluid">
        <div className="row">
          <Sidebar
            currentYear={currentYear}
            onYearClick={handleYearClick}
            goals={goals}
            onGoalsChange={setGoals}
            estimatedYearEnd={estimatedYearEnd}
            currentDistance={currentDistance}
          />

          <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
            <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
              <h1 className="h2">Desirelines as of {new Date().toDateString()}</h1>
            </div>
            {!isInitializing && goals.length > 0 && (
              <>
                <DistanceChart year={currentYear} goals={goals} onGoalsChange={setGoals} />
                <PacingChart year={currentYear} goals={goals} onGoalsChange={setGoals} />
                <GoalSummaryTable
                  goals={goals}
                  currentDistance={currentDistance}
                  year={currentYear}
                />
              </>
            )}
            {isInitializing && <p>Loading goals...</p>}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
