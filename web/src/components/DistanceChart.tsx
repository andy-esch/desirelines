// src/components/DistanceChart.tsx
import { useEffect, useState } from "react";
import { Chart as ChartJS, TimeScale } from "chart.js/auto";
import { Line } from "react-chartjs-2";
import { fetchDistanceData } from "../api/activities";
import type { RideBlobType } from "../types/activity";
import { EMPTY_RIDE_DATA } from "../constants";
import { CHART_COLORS } from "../constants/chartColors";
import "chartjs-adapter-date-fns";
import { offsetDate } from "./utils";

ChartJS.register(TimeScale);

const DistanceChart = (props: { year: number }) => {
  const { year } = props;
  const [rideData, setRideData] = useState<RideBlobType>(EMPTY_RIDE_DATA);
  const [maxRangeValue, setMaxRangeValue] = useState<number>(0);
  const [minRangeValue, setMinRangeValue] = useState<number>(0);
  const [totalDistanceTraveled, setTotalDistanceTraveled] = useState<number>(0);
  const [latestDate, setLatestDate] = useState<string>("2024-01-01");

  const fetchRideData = async (year: number) => {
    const rideData: RideBlobType = await fetchDistanceData(year);
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
  };
  // set data to load by year
  useEffect(() => {
    fetchRideData(year);
  }, [year]);

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
