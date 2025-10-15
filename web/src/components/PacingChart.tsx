// src/components/PacingChart.tsx
import React, { useEffect, useState } from "react";
import { Chart as ChartJS, TimeScale } from "chart.js/auto";
import { Line } from "react-chartjs-2";
import { fetchPacingData } from "../api/activities";
import type { PacingBlobType } from "../types/activity";
import { EMPTY_PACING_DATA } from "../constants";
import "chartjs-adapter-date-fns";
import { offsetDate } from "./utils";

ChartJS.register(TimeScale);

const PacingChart = (props: { year: number }) => {
  const [pacingData, setPacingData] = useState<PacingBlobType>(EMPTY_PACING_DATA);
  const [latestDate, setLatestDate] = useState<string>("2024-02-03");
  const { year } = props;
  const fetchData = async (year: number) => {
    const pacingData: PacingBlobType = await fetchPacingData(year);
    setPacingData(pacingData);

    // Defensive programming - check if data exists
    if (pacingData.pacing && pacingData.pacing.length > 0) {
      const lastEntry = pacingData.pacing[pacingData.pacing.length - 1];
      if (lastEntry && lastEntry.x) {
        const dateOffset = offsetDate(lastEntry.x);
        setLatestDate(dateOffset);
      }
    }
  };
  useEffect(() => {
    fetchData(year);
  }, [year]);

  const lineChart = (
    <Line
      data={{
        datasets: [
          {
            data: pacingData.pacing,
            label: `${year} Pacing Data`,
            pointRadius: 0,
            borderColor: "rgb(0, 0, 0, 0.8)",
            backgroundColor: "rgb(0, 0, 0, 0.5)",
          },
          {
            data: pacingData.lower_pacing,
            label: `Lower Pacing`,
            pointRadius: 0,
            borderColor: "rgb(0, 255, 255)",
            segment: {
              borderColor: "rgb(0, 255, 255)",
            },
          },
          {
            data: pacingData.upper_pacing,
            label: `Upper Pacing`,
            pointRadius: 0,
            borderColor: "rgb(255, 0, 255)",
            segment: {
              borderColor: "rgb(255, 0, 255)",
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
