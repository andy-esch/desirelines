/**
 * Resolves the sustainable-pace ceiling ("danger zone") for a sport into the
 * user's preferred display units.
 *
 * Source of truth is `sportCategories[sport].dangerPace` in sport_types.json
 * (returned by the public /sports/config endpoint). When not present the hook
 * returns Infinity, which the UI treats as "no ceiling".
 */
import type { DangerPace } from "../api/activities";
import {
  convertDistance,
  convertElevation,
  convertToMeters,
  getUserSettings,
  METERS_TO_FEET,
  type DistanceUnit,
  type ElevationUnit,
} from "../utils/units";
import { usePublicSportConfig } from "./usePublicSportConfig";
import { useUserConfig } from "./useUserConfig";

export function useDangerThresholds() {
  const { sportConfig } = usePublicSportConfig();
  const { data: preferences } = useUserConfig("preferences");
  const { distanceUnit, elevationUnit } = getUserSettings(preferences);

  const getThreshold = (sport: string): number => {
    const pace = sportConfig?.sportCategories?.[sport]?.dangerPace;
    if (!pace) return Infinity;
    return resolveDangerPace(pace, distanceUnit, elevationUnit);
  };

  return { getThreshold };
}

/**
 * Resolve a config-defined dangerPace into the user's display unit.
 * Exported (and isolated from React hooks) so callers can resolve a sport's
 * threshold from a snapshot of sportConfig without re-running the hook.
 */
export function resolveDangerPace(
  pace: DangerPace,
  distanceUnit: DistanceUnit,
  elevationUnit: ElevationUnit
): number {
  switch (pace.unit) {
    case "miles":
    case "kilometers":
    case "meters": {
      const meters = convertToMeters(pace.valuePerDay, pace.unit);
      return roundDp(convertDistance(meters, distanceUnit), 4);
    }
    case "feet": {
      const meters = pace.valuePerDay / METERS_TO_FEET;
      return roundDp(convertElevation(meters, elevationUnit), 4);
    }
    case "hours":
      return pace.valuePerDay;
    case "minutes":
      return pace.valuePerDay / 60;
    case "sessions":
      return pace.valuePerDay;
  }
}

function roundDp(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
