// src/components/charts/DistanceChart.tsx
import { useEffect, useState } from "react";
import { Chart as ChartJS, TimeScale } from "chart.js/auto";
import { Line } from "react-chartjs-2";
import { fetchDistanceData } from "../../api/activities";
import type { RideBlobType } from "../../types/activity";
import { EMPTY_RIDE_DATA } from "../../constants";
import { CHART_COLORS } from "../../constants/chartColors";
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import "chartjs-adapter-date-fns";
import { offsetDate } from "../utils";

ChartJS.register(TimeScale);

const DistanceChart = (props: { year: number }) => {
  const { year } = props;
  const [rideData, setRideData] = useState<RideBlobType>(EMPTY_RIDE_DATA);
  const [maxRangeValue, setMaxRangeValue] = useState<number>(0);
  const [minRangeValue, setMinRangeValue] = useState<number>(0);
  const [totalDistanceTraveled, setTotalDistanceTraveled] = useState<number>(0);
  const [latestDate, setLatestDate] = useState<string>("2024-01-01");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchRideData = async (year: number, signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const rideData: RideBlobType = await fetchDistanceData(year, signal);
      setRideData(rideData);

      // Defensive programming - check if data exists
      if (rideData.summaries && Object.keys(rideData.summaries).length > 0) {
        const range = Object.keys(rideData.summaries).map((x) => {
          return parseInt(x);
        });
        setMaxRangeValue(Math.max(...range));
        setMinRangeValue(Math.min(...range));
      }

      if (rideData.distance_traveled && rideData.distance_traveled.length > 0) {
        const lastEntry = rideData.distance_traveled[rideData.distance_traveled.length - 1];
        if (lastEntry && lastEntry.y !== undefined) {
          setTotalDistanceTraveled(lastEntry.y);
        }
        if (lastEntry && lastEntry.x) {
          const dateOffset = offsetDate(lastEntry.x);
          setLatestDate(dateOffset);
        }
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

  const lineChart = (
    <Line
      data={{
        datasets: [
          {
            label: `${year} Data: ${totalDistanceTraveled.toFixed(1)} miles`,
            data: rideData.distance_traveled,
            pointRadius: 0,
            borderColor: CHART_COLORS.ACTUAL_DATA_LINE,
            backgroundColor: CHART_COLORS.ACTUAL_DATA_FILL,
          },
          {
            label: `Goal: ${minRangeValue} miles`,
            data: rideData.lower_distance,
            pointRadius: 0,
            borderColor: CHART_COLORS.LOWER_GOAL_LINE,
            segment: {
              borderColor: CHART_COLORS.LOWER_GOAL_LINE,
            },
          },
          {
            label: `Goal: ${maxRangeValue} miles`,
            data: rideData.upper_distance,
            pointRadius: 0,
            borderColor: CHART_COLORS.UPPER_GOAL_LINE,
            segment: {
              borderColor: CHART_COLORS.UPPER_GOAL_LINE,
            },
          },
          {
            label: "Average Pacing",
            data: rideData.avg_distance,
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
            suggestedMax: latestDate,
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
