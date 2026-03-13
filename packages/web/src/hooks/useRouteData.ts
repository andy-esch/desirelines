import { useQuery } from "@tanstack/react-query";
import { fetchRoutes, type NormalizedRoute, type RouteRing } from "../api/routes";
import { useAuth } from "./useAuth";

export interface UseRouteDataOptions {
  /** Ring radii in meters. If provided, distance rings are fetched from the backend. */
  ringMeters?: number[];
}

export interface UseRouteDataResult {
  routes: NormalizedRoute[];
  rings: RouteRing[];
  isLoading: boolean;
  error: Error | null;
}

export function useRouteData(options: UseRouteDataOptions = {}): UseRouteDataResult {
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["routes", user?.uid, options.ringMeters],
    queryFn: ({ signal }) => fetchRoutes({ signal, ringMeters: options.ringMeters }),
    enabled: !authLoading && !!user,
  });

  return {
    routes: data?.routes ?? [],
    rings: data?.rings ?? [],
    isLoading: authLoading || isLoading,
    error: error as Error | null,
  };
}
