/**
 * Test-only fixture helpers for `Goal` / `Goals`.
 *
 * The production `Goal` type matches the proto shape (6 required fields).
 * Tests that only exercise display-layer logic (validation, pacing math,
 * rendering) don't need to care about `metric`, `createdAt`, or `updatedAt`,
 * so this helper fills them with stable defaults.
 *
 * Keep this file under `src/utils/` rather than `__test_helpers__/` because
 * Vitest's bundler resolves it the same as any other module — separating
 * directories adds no isolation but breaks tsc path-mapping.
 */
import { buildGoal, type Goal, type Goals } from "./goalCalculations";

/** Stable fixed timestamp; tests that care about freshness should override. */
const FIXTURE_TIMESTAMP = "2025-01-01T00:00:00.000Z";

/** Build a `Goal` for tests, filling required proto fields with stable defaults. */
export function testGoal(partial: Partial<Goal> & Pick<Goal, "id" | "value">): Goal {
  const base = buildGoal(
    {
      id: partial.id,
      value: partial.value,
      label: partial.label ?? "",
      metric: partial.metric ?? "distance_meters",
    },
    partial.createdAt ?? FIXTURE_TIMESTAMP
  );
  // Honor an explicit updatedAt if the test provided one; otherwise leave the
  // matched-pair stamp from buildGoal (createdAt === updatedAt at creation).
  return partial.updatedAt ? { ...base, updatedAt: partial.updatedAt } : base;
}

/** Build a `Goals` array for tests. */
export function testGoals(partials: Array<Partial<Goal> & Pick<Goal, "id" | "value">>): Goals {
  return partials.map(testGoal);
}
