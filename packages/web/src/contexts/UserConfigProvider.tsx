import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../hooks/useAuth";
import { useServices } from "./ServiceContext";
import { useOptionalToast } from "./ToastContext";
import { logApiError } from "../api/errors";
import type { ConfigAdapter } from "../services/config/configAdapter";
import { createDemoAdapter } from "../services/config/demoAdapter";
import { createFirestoreAdapter } from "../services/config/firestoreAdapter";

export interface UserConfigStore {
  /** Where this session's config lives; null until sign-in has resolved. */
  adapter: ConfigAdapter | null;
  /** The listener's last error, cleared by the next good snapshot. */
  liveError: Error | null;
}

export const UserConfigContext = createContext<UserConfigStore | null>(null);

/** Shown once per listener error, while the store keeps showing its last good copy. */
const SYNC_ERROR_MESSAGE =
  "Your settings couldn't be synced, so what's shown may be out of date. Reload to try again.";

/**
 * Holds the session's user config in one place: one cache entry for the whole document, and
 * one listener keeping it current, however many components read it. Signed in, that's the
 * account's Firestore document; signed out, the demo's own storage. Read it with
 * `useUserConfig` or `useConfigDocument`; mount it inside `AuthProvider` and the query client.
 *
 * A listener error keeps the last good copy: an error is reported, never shown as an empty
 * document, which would read as nothing saved and invite saves over what is.
 */
export function UserConfigProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { authService, databaseService } = useServices();
  const queryClient = useQueryClient();
  const toast = useOptionalToast();
  const uid = user?.uid ?? null;

  const adapter = useMemo(() => {
    if (authLoading) return null;
    return uid
      ? createFirestoreAdapter(uid, { authService, databaseService })
      : createDemoAdapter();
  }, [authLoading, uid, authService, databaseService]);

  // Kept with the adapter it came from, so a new session starts without the last one's error.
  const [liveError, setLiveError] = useState<{ from: ConfigAdapter; error: Error } | null>(null);

  useEffect(() => {
    if (!adapter?.subscribe) return;
    return adapter.subscribe(
      (doc) => {
        queryClient.setQueryData(adapter.queryKey, doc);
        setLiveError(null);
      },
      (error) => {
        logApiError(error, "[UserConfigProvider] config listener");
        setLiveError({ from: adapter, error });
        toast?.showToast(SYNC_ERROR_MESSAGE, "warning");
      }
    );
  }, [adapter, queryClient, toast]);

  const value = useMemo<UserConfigStore>(
    () => ({ adapter, liveError: liveError?.from === adapter ? liveError.error : null }),
    [adapter, liveError]
  );

  return <UserConfigContext.Provider value={value}>{children}</UserConfigContext.Provider>;
}
