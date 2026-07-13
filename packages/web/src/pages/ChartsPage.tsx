/**
 * Placeholder for the Charts view — interactive, filterable charts across ALL
 * activities (geographic and non-geographic), so indoor/virtual workouts stay
 * visible even though they can't go on the map. The real view is built in a
 * sibling task; this stub exists so the Activities-group nav + `/charts` route
 * and its shared URL filters have a landing target.
 */
import { PageLayout } from "../components/layout/PageLayout";

export default function ChartsPage() {
  return (
    <PageLayout background="activities">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-body-text">Charts</h1>
        <p className="mt-3 text-slate-light">
          Interactive charts across all your activities — including the indoor and virtual workouts
          that don’t appear on the map — are coming here soon.
        </p>
      </div>
    </PageLayout>
  );
}
