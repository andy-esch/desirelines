import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDashboardGoalData, type SportGoalData } from "../../hooks/useDashboardGoalData";
import { useTrailingYearActivityCount } from "../../hooks/useTrailingYearActivityCount";
import { useWeeklySummary } from "../../hooks/useWeeklySummary";
import { getTodayUtcAnchored } from "../../utils/dateUtils";
import type { TuningParams } from "../../utils/demoDataGenerator";
import { PACE_THRESHOLDS } from "../../utils/goalCalculations";
import { getIsoWeek, getMonthShareOfYear } from "../../utils/yearClock";
import { getYearElapsedShare } from "../../utils/yearContext";
import { HeroDecoration } from "../theme/HeroDecoration";
import { Meter } from "../theme/Meter";
import { LoadingValue } from "../theme/LoadingValue";
import { MissingValue } from "../theme/MissingValue";
import { useThemeStructure } from "../theme/useThemeStructure";

/**
 * Goals with a target that are on pace today: achieved, or at least the on-track share of
 * where linear pacing puts them. Sports without a target, including those with no goal
 * (whose target is 0), don't count toward the total.
 */
export function countGoalsOnPace(
  sports: Pick<SportGoalData, "currentValue" | "targetGoal">[],
  /** How much of the year has elapsed, from `getYearElapsedShare`. */
  share: number
): { onPace: number; total: number } {
  const withGoals = sports.filter((s) => s.targetGoal > 0);
  const onPace = withGoals.filter((s) => {
    if (s.currentValue >= s.targetGoal) return true;
    const prorated = s.targetGoal * share;
    if (prorated === 0) return s.currentValue > 0;
    return s.currentValue / prorated >= PACE_THRESHOLDS.ON_TRACK;
  }).length;
  return { onPace, total: withGoals.length };
}

function HeroNumber({
  value,
  suffix,
  label,
  className,
  card,
}: {
  value: ReactNode;
  suffix?: ReactNode | undefined;
  label: string;
  className: string;
  /** Frame the number in a card: the panel ground inside a `--hero-card-edge` border. */
  card: boolean;
}) {
  return (
    // The label comes first for assistive tech; the number shows above it.
    <div
      className={cn(
        "flex flex-col gap-1.5",
        // Three cards don't fit across a phone, so there each is a row: number, then label.
        card &&
          "rounded-(--panel-radius) border-2 border-transparent px-4 py-2.5 max-sm:flex-row max-sm:items-center max-sm:justify-between sm:min-w-[124px] sm:px-5 sm:py-3.5 [background:linear-gradient(var(--panel-bg),var(--panel-bg))_padding-box,var(--hero-card-edge)_border-box] [box-shadow:var(--hero-card-shadow)]"
      )}
    >
      <dt className="text-(length:--stat-label-size) tracking-(--stat-label-tracking) text-(color:--hero-ink) [text-transform:var(--stat-label-case)]">
        {label}
      </dt>
      <dd
        className={cn(
          "m-0 order-first font-display font-normal leading-none tabular-nums text-(length:--hero-number-size) [text-shadow:0_0_var(--hero-number-glow)_color-mix(in_srgb,currentColor_60%,transparent)]",
          className
        )}
      >
        {/* The digits take the display gradient where the theme has one, as the title does. */}
        <span className="neon-gradient-text">{value}</span>
        {suffix}
      </dd>
    </div>
  );
}

/**
 * The dashboard's hero band where the theme has a hero decoration: a year clock (week,
 * day of the year and a month meter) and three numbers the app already has, over the
 * theme's decoration.
 */
export default function DashboardHero({
  tuningParams,
}: {
  tuningParams?: TuningParams | undefined;
}) {
  const { heroDecoration, heroNumberFrame } = useThemeStructure();
  const card = heroNumberFrame === "card";
  const { sportData, yearContext, isLoading: goalsLoading } = useDashboardGoalData();
  const { sportTotals, isLoading: weekLoading } = useWeeklySummary();
  const { count, isLoading: countLoading } = useTrailingYearActivityCount(tuningParams);

  const today = getTodayUtcAnchored();
  const distanceSports = sportTotals.filter((s) => s.metricType === "distance");
  const weekDistance = distanceSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const distanceUnit = distanceSports[0]?.metricUnit ?? "mi";
  const goals = countGoalsOnPace(sportData, getYearElapsedShare(yearContext));
  const pending = <LoadingValue />;

  return (
    <section
      aria-label="Year at a glance"
      className="relative overflow-hidden p-(--hero-padding)"
      data-hero={heroDecoration}
    >
      <HeroDecoration kind={heroDecoration} />
      <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="flex flex-col gap-3">
          <span className="text-(length:--kicker-size) tracking-(--kicker-tracking) text-(color:--hero-ink) [text-transform:var(--label-case)]">
            {yearContext.year} · Week {getIsoWeek(today)}
          </span>
          <h1 className="m-0 font-display font-normal leading-none text-(length:--hero-title-size) text-(color:--hero-title-color) [text-shadow:var(--hero-title-shadow)] [text-transform:var(--page-title-case)] neon-gradient-text">
            <span className="sr-only">Dashboard: </span>
            Day {yearContext.daysElapsed}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <Meter
              value={getMonthShareOfYear(today)}
              segments={12}
              label={`${yearContext.year} progress by month`}
            />
            <span className="text-xs tracking-[0.1em] text-(color:--hero-ink) [text-transform:var(--label-case)]">
              {yearContext.daysRemaining} days left in {yearContext.year}
            </span>
          </div>
        </div>
        {/* Three columns on phones, so no number sits alone on a second row. */}
        <dl
          className={cn(
            "m-0 grid gap-x-4 text-left sm:flex sm:text-right",
            card ? "gap-y-3" : "grid-cols-3 sm:gap-x-10"
          )}
        >
          <HeroNumber
            label="This week"
            card={card}
            value={weekLoading ? pending : Math.round(weekDistance).toLocaleString()}
            suffix={
              weekLoading ? undefined : (
                <span className="ms-1 text-[0.42em] text-[color:var(--hero-number-unit-color,currentColor)] [text-transform:var(--label-case)]">
                  {distanceUnit}
                </span>
              )
            }
            className="text-accent-cyan"
          />
          <HeroNumber
            label="Activities · 12 mo"
            card={card}
            value={countLoading ? pending : count.toLocaleString()}
            className="text-(color:--hero-title-color)"
          />
          {/* With no goals set there's nothing to be on pace for: the missing value, not 0/0. */}
          <HeroNumber
            label="Goals on pace"
            card={card}
            value={goalsLoading ? pending : goals.total === 0 ? <MissingValue /> : goals.onPace}
            suffix={
              goalsLoading || goals.total === 0 ? undefined : (
                <span className="text-[0.53em] text-(color:--hero-ink)">/{goals.total}</span>
              )
            }
            className="text-accent-magenta"
          />
        </dl>
      </div>
    </section>
  );
}
