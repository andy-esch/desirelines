// src/components/charts/PacingChart.tsx
import { useEffect, useState } from "react";
import { Chart as ChartJS, TimeScale } from "chart.js/auto";
import { Line } from "react-chartjs-2";
import { fetchPacingData } from "../../api/activities";
import type { PacingBlobType } from "../../types/activity";
import { EMPTY_PACING_DATA } from "../../constants";
import { CHART_COLORS } from "../../constants/chartColors";
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import "chartjs-adapter-date-fns";
import { offsetDate } from "../utils";

ChartJS.register(TimeScale);

const PacingChart = (props: { year: number }) => {
  const [pacingData, setPacingData] = useState<PacingBlobType>(EMPTY_PACING_DATA);
  const [latestDate, setLatestDate] = useState<string>("2024-02-03");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const { year } = props;

  const fetchData = async (year: number, signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const pacingData: PacingBlobType = await fetchPacingData(year, signal);
      setPacingData(pacingData);

      // Defensive programming - check if data exists
      if (pacingData.pacing && pacingData.pacing.length > 0) {
        const lastEntry = pacingData.pacing[pacingData.pacing.length - 1];
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

  const lineChart = (
    <Line
      data={{
        datasets: [
          {
            data: pacingData.pacing,
            label: `${year} Pacing Data`,
            pointRadius: 0,
            borderColor: CHART_COLORS.ACTUAL_DATA_LINE,
            backgroundColor: CHART_COLORS.ACTUAL_DATA_FILL,
          },
          {
            data: pacingData.lower_pacing,
            label: `Lower Pacing`,
            pointRadius: 0,
            borderColor: CHART_COLORS.LOWER_GOAL_LINE,
            segment: {
              borderColor: CHART_COLORS.LOWER_GOAL_LINE,
            },
          },
          {
            data: pacingData.upper_pacing,
            label: `Upper Pacing`,
            pointRadius: 0,
            borderColor: CHART_COLORS.UPPER_GOAL_LINE,
            segment: {
              borderColor: CHART_COLORS.UPPER_GOAL_LINE,
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
