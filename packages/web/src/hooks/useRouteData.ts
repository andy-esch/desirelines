import { useQuery } from "@tanstack/react-query";
import { fetchRoutes, type NormalizedRoute } from "../api/routes";
import { useAuth } from "./useAuth";

export interface UseRouteDataResult {
  routes: NormalizedRoute[];
  isLoading: boolean;
  error: Error | null;
}

export function useRouteData(): UseRouteDataResult {
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["routes", user?.uid],
    queryFn: ({ signal }) => fetchRoutes({ signal }),
    enabled: !authLoading && !!user,
    staleTime: 5 * 60 * 1000,
  });

  return {
    routes: data ?? [],
    isLoading: authLoading || isLoading,
    error: error as Error | null,
  };
}
