// src/components/charts/DistanceChart.tsx
import { useEffect, useState } from "react";
import { Chart as ChartJS, TimeScale } from "chart.js/auto";
import { Line } from "react-chartjs-2";
import { fetchDistanceData } from "../../api/activities";
import type { DistanceEntry } from "../../types/activity";
import { CHART_COLORS } from "../../constants/chartColors";
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import {
  calculateDesireLine,
  calculateCurrentAverageLine,
  estimateYearEndDistance,
  generateDefaultGoals,
  type Goals,
} from "../../utils/goalCalculations";
import "chartjs-adapter-date-fns";
import { offsetDate } from "../utils";

ChartJS.register(TimeScale);

interface DistanceChartProps {
  year: number;
  goals: Goals;
  onGoalsChange?: (goals: Goals) => void;
}

const DistanceChart = (props: DistanceChartProps) => {
  const { year, goals } = props;
  // Data from backend (only distance_traveled, ignore goal fields)
  const [distanceTraveled, setDistanceTraveled] = useState<DistanceEntry[]>([]);
  const [totalDistanceTraveled, setTotalDistanceTraveled] = useState<number>(0);
  const [latestDate, setLatestDate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Frontend-calculated stats
  const [estimatedYearEnd, setEstimatedYearEnd] = useState<number>(0);

  const fetchRideData = async (year: number, signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const rideData = await fetchDistanceData(year, signal);

      // Only use distance_traveled from backend (ignore backend-calculated goals)
      if (rideData.distance_traveled && rideData.distance_traveled.length > 0) {
        const distances = rideData.distance_traveled;
        setDistanceTraveled(distances);

        const lastEntry = distances[distances.length - 1];
        if (lastEntry) {
          setTotalDistanceTraveled(lastEntry.y);
          setLatestDate(new Date(lastEntry.x));
        }

        // Calculate estimated year-end distance
        console.time("DistanceChart: estimateYearEndDistance");
        const estimated = estimateYearEndDistance(distances, year);
        setEstimatedYearEnd(estimated);
        console.timeEnd("DistanceChart: estimateYearEndDistance");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  // set data to load by year, cancel previous request on year change
  useEffect(() => {
    const abortController = new AbortController();
    fetchRideData(year, abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [year]);

  if (isLoading) {
    return (
      <div>
        <h2 style={{ textAlign: "center" }}>Distances</h2>
        <LoadingChart />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 style={{ textAlign: "center" }}>Distances</h2>
        <ErrorChart error={error} onRetry={() => fetchRideData(year)} />
      </div>
    );
  }

  // Calculate goal lines using frontend utilities
  console.time("DistanceChart: calculateDesireLines");
  const goalLines = goals.map(goal => ({
    goal,
    line: calculateDesireLine(goal.value, year, latestDate)
  }));
  console.timeEnd("DistanceChart: calculateDesireLines");

  console.time("DistanceChart: calculateCurrentAverageLine");
  const currentAverageLine = calculateCurrentAverageLine(distanceTraveled, year, latestDate);
  console.timeEnd("DistanceChart: calculateCurrentAverageLine");

  // Define colors for up to 5 goals
  const goalColors = [
    CHART_COLORS.LOWER_GOAL_LINE,    // cyan
    CHART_COLORS.UPPER_GOAL_LINE,    // magenta
    'rgb(100, 255, 100)',             // green
    'rgb(255, 200, 0)',               // orange
    'rgb(150, 100, 255)',             // purple
  ];

  const lineChart = (
    <Line
      data={{
        datasets: [
          {
            label: `${year} Data: ${totalDistanceTraveled.toFixed(1)} miles`,
            data: distanceTraveled,
            pointRadius: 0,
            borderColor: CHART_COLORS.ACTUAL_DATA_LINE,
            backgroundColor: CHART_COLORS.ACTUAL_DATA_FILL,
          },
          ...goalLines.map((gl, index) => ({
            label: `${gl.goal.label || 'Goal'}: ${gl.goal.value} miles`,
            data: gl.line,
            pointRadius: 0,
            borderColor: goalColors[index % goalColors.length],
            segment: {
              borderColor: goalColors[index % goalColors.length],
            },
          })),
          {
            label: `Current Average (Est: ${estimatedYearEnd.toFixed(0)} miles)`,
            data: currentAverageLine,
            pointRadius: 0,
            borderColor: CHART_COLORS.AVERAGE_LINE,
            segment: {
              borderColor: CHART_COLORS.AVERAGE_LINE,
              borderDash: [6, 6],
            },
          },
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
        },
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            position: "chartArea",
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
      <h2 style={{ textAlign: "center" }}>Distances</h2>
      <div className="chart-container">{lineChart}</div>
    </div>
  );
};
export default DistanceChart;
