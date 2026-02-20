import { useNavigate } from "@tanstack/react-router";
import { useCurrentYear } from "../hooks/useCurrentYear";
import { useSportPageData } from "../hooks/useSportPageData";
import MomentumIndicator from "../components/MomentumIndicator";
import SportPageContent from "../components/SportPageContent";

interface SportPageProps {
  sport: string;
  year: string;
}

export default function SportPage({ sport, year }: SportPageProps) {
  const navigate = useNavigate();
  const fallbackYear = useCurrentYear();
  const parsedYear = year ? parseInt(year, 10) : NaN;
  const currentYear = Number.isFinite(parsedYear) ? parsedYear : fallbackYear;

  const data = useSportPageData(sport, currentYear);

  return (
    <SportPageContent
      sport={sport}
      currentYear={data.currentYear}
      yearContext={data.yearContext}
      chartData={data.chartData}
      currentValue={data.currentValue}
      estimatedYearEnd={data.estimatedYearEnd}
      isLoading={data.isLoading}
      error={data.error}
      onRetry={data.retry}
      unit={data.unit}
      goals={data.goals}
      chartGoals={data.chartGoals}
      onGoalsChange={data.onGoalsChange}
      isGoalsSaving={data.isGoalsSaving}
      goalsSaveError={data.goalsSaveError}
      onClearGoalsSaveError={data.clearGoalsSaveError}
      nextGoal={data.nextGoal}
      nextGoalProgress={data.nextGoalProgress}
      nextGoalGap={data.nextGoalGap}
      paceNeededForNextGoal={data.paceNeededForNextGoal}
      averagePace={data.averagePace}
      momentumIndicator={
        <MomentumIndicator
          momentumLevel={data.momentumLevel}
          trainingMomentum={data.trainingMomentum}
        />
      }
      availableSports={data.availableSports}
      sportCounts={data.sportCounts}
      showAuthButton={true}
      onSportChange={(newSport) =>
        navigate({ to: "/$sport/$year", params: { sport: newSport, year: String(currentYear) } })
      }
      onYearChange={(newYear) =>
        navigate({ to: "/$sport/$year", params: { sport, year: String(newYear) } })
      }
      routePrefix=""
      availableMetrics={data.availableMetrics}
      activeMetric={data.activeMetric}
      onMetricChange={data.onMetricChange}
      priorYearData={data.priorYearData}
      showPriorYears={data.showPriorYears}
      onPriorYearsChange={data.onPriorYearsChange}
    />
  );
}
