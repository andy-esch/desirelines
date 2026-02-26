import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useServices } from "../contexts/ServiceContext";
import { UserProfileService } from "../services/userProfileService";

/**
 * Hook for accessing the athlete profile with real-time Firestore sync.
 */
export function useUserProfile() {
  const { user, loading: authLoading } = useAuth();
  const { authService, databaseService } = useServices();
  const queryClient = useQueryClient();

  const isGuest = !user;

  const profileService = useMemo(() => {
    if (isGuest) return null;
    return new UserProfileService({ authService, databaseService });
  }, [isGuest, authService, databaseService]);

  const queryKey = useMemo(() => ["userProfile", user?.uid], [user?.uid]);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      if (isGuest || !profileService) return null;
      return profileService.getProfile();
    },
    enabled: !authLoading && !isGuest,
    staleTime: Infinity, // Real-time subscription handles updates
  });

  // Real-time subscription
  useEffect(() => {
    if (isGuest || !profileService) return;

    const unsubscribe = profileService.subscribeToProfile((newProfile) => {
      queryClient.setQueryData(queryKey, newProfile);
    });

    return unsubscribe;
  }, [isGuest, profileService, queryClient, queryKey]);

  const displayName = useMemo(() => {
    if (isGuest) return "Guest";
    if (data) {
      const { first_name, last_name } = data;
      if (first_name && last_name) return `${first_name} ${last_name}`;
      if (first_name) return first_name;
    }
    return "Athlete";
  }, [isGuest, data]);

  return {
    profile: data ?? null,
    displayName,
    loading: isLoading || authLoading,
    error: (error as Error | null) || null,
  };
}
