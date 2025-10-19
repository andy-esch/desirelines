// src/components/charts/PacingChart.tsx
import { useEffect, useState } from "react";
import { Chart as ChartJS, TimeScale } from "chart.js/auto";
import { Line } from "react-chartjs-2";
import { fetchDistanceData } from "../../api/activities";
import type { DistanceEntry, PacingEntry } from "../../types/activity";
import { CHART_COLORS } from "../../constants/chartColors";
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import {
  calculateActualPacing,
  calculateDynamicPacingGoal,
  type Goals,
} from "../../utils/goalCalculations";
import "chartjs-adapter-date-fns";
import { offsetDate } from "../utils";

ChartJS.register(TimeScale);

interface PacingChartProps {
  year: number;
  goals: Goals;
  onGoalsChange?: (goals: Goals) => void;
}

const PacingChart = (props: PacingChartProps) => {
  const { year, goals } = props;
  // Data from backend (only distance_traveled)
  const [distanceTraveled, setDistanceTraveled] = useState<DistanceEntry[]>([]);
  const [latestDate, setLatestDate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Frontend-calculated pacing data
  const [actualPacing, setActualPacing] = useState<PacingEntry[]>([]);

  const fetchData = async (year: number, signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const rideData = await fetchDistanceData(year, signal);

      // Only use distance_traveled from backend
      if (rideData.distance_traveled && rideData.distance_traveled.length > 0) {
        const distances = rideData.distance_traveled;
        setDistanceTraveled(distances);

        const lastEntry = distances[distances.length - 1];
        if (lastEntry) {
          setLatestDate(new Date(lastEntry.x));
        }

        // Calculate actual pacing from distance data
        const pacing = calculateActualPacing(distances, new Date(lastEntry?.x || new Date()));
        setActualPacing(pacing);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const abortController = new AbortController();
    fetchData(year, abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [year]);

  if (isLoading) {
    return (
      <div>
        <h2 style={{ textAlign: "center" }}>Pacings</h2>
        <LoadingChart />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 style={{ textAlign: "center" }}>Pacings</h2>
        <ErrorChart error={error} onRetry={() => fetchData(year)} />
      </div>
    );
  }

  // Calculate dynamic pacing goals using frontend utilities
  const pacingGoals = goals.map((goal) => ({
    goal,
    pacing: calculateDynamicPacingGoal(distanceTraveled, goal.value, year, latestDate),
  }));

  // Define colors for up to 5 goals (same as DistanceChart)
  const goalColors = [
    CHART_COLORS.LOWER_GOAL_LINE,
    CHART_COLORS.UPPER_GOAL_LINE,
    "rgb(100, 255, 100)",
    "rgb(255, 200, 0)",
    "rgb(150, 100, 255)",
  ];

  const lineChart = (
    <Line
      data={{
        datasets: [
          {
            data: actualPacing,
            label: `${year} Pacing Data`,
            pointRadius: 0,
            borderColor: CHART_COLORS.ACTUAL_DATA_LINE,
            backgroundColor: CHART_COLORS.ACTUAL_DATA_FILL,
          },
          ...pacingGoals.map((pg, index) => ({
            data: pg.pacing,
            label: `${pg.goal.label || "Goal"} Pacing: ${pg.goal.value} miles`,
            pointRadius: 0,
            borderColor: goalColors[index % goalColors.length],
            segment: {
              borderColor: goalColors[index % goalColors.length],
            },
          })),
        ],
      }}
      options={{
        scales: {
          x: {
            type: "time",
            suggestedMax: offsetDate(latestDate.toISOString()),
            time: {
              unit: "week",
            },
          },
          y: { min: 0 },
        },
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            position: "top",
          },
          tooltip: {
            position: "average",
          },
        },
      }}
    />
  );
  return (
    <div>
      <h2 style={{ textAlign: "center" }}>Pacings</h2>
      <div className="chart-container">{lineChart}</div>
    </div>
  );
};

export default PacingChart;
