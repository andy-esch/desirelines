// src/components/DistanceChart.js
import React, { useEffect, useState } from "react";
import { Chart as ChartJS, TimeScale } from "chart.js/auto";
import { Line } from "react-chartjs-2";
import { fetchDistanceData, rideBlobType, emptyRideData } from "./Data";
import "chartjs-adapter-date-fns";
import { offsetDate } from "./utils";

ChartJS.register(TimeScale);

const DistanceChart = (props: { year: number }) => {
  console.log(props);
  const { year } = props;
  console.log(`year: ${year}`);
  const [rideData, setRideData] = useState<rideBlobType>(emptyRideData);
  const [maxRangeValue, setMaxRangeValue] = useState<number>(0);
  const [minRangeValue, setMinRangeValue] = useState<number>(0);
  const [totalDistanceTraveled, setTotalDistanceTraveled] = useState<number>(0);
  const [latestDate, setLatestDate] = useState<string>("2024-01-01");

  const fetchRideData = async (year: number) => {
    const rideData: rideBlobType = await fetchDistanceData(year);
    console.log("rideData:", rideData);
    setRideData(rideData);

    // Defensive programming - check if data exists
    if (rideData.summaries && rideData.summaries.length > 0) {
      const range = Object.keys(rideData.summaries).map((x) => {
        return parseInt(x);
      });
      setMaxRangeValue(Math.max(...range));
      setMinRangeValue(Math.min(...range));
    }

    if (rideData.distance_traveled && rideData.distance_traveled.length > 0) {
      const lastEntry =
        rideData.distance_traveled[rideData.distance_traveled.length - 1];
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
            label: `2024 Data: ${totalDistanceTraveled.toFixed(1)} miles`,
            data: rideData.distance_traveled,
            pointRadius: 0,
            borderColor: "rgb(0, 0, 0, 0.8)",
            backgroundColor: "rgb(0, 0, 0, 0.5)",
          },
          {
            label: `Goal: ${minRangeValue} miles`,
            data: rideData.lower_distance,
            pointRadius: 0,
            borderColor: "rgb(0, 255, 255)",
            segment: {
              borderColor: "rgb(0, 255, 255)",
            },
          },
          {
            label: `Goal: ${maxRangeValue} miles`,
            data: rideData.upper_distance,
            pointRadius: 0,
            borderColor: "rgb(255, 0, 255)",
            segment: {
              borderColor: "rgb(255, 0, 255)",
            },
          },
          {
            label: "Average Pacing",
            data: rideData.avg_distance,
            pointRadius: 0,
            borderColor: "rgb(255, 95, 31)",
            segment: {
              borderColor: "rgb(255, 95, 31)",
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
            // suggestedMax: "2024-06-01",
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
