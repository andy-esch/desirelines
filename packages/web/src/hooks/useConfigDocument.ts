import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserConfigContext } from "../contexts/UserConfigProvider";
import type { ConfigAdapter } from "../services/config/configAdapter";
import type { UserConfig } from "../services/userConfigService";

/**
 * The session's whole config document, from the store `UserConfigProvider` holds: one cache
 * entry and one listener, shared by every caller. Read a section with `selectSection` from
 * `services/config/sections.ts`, and apply defaults there, never in the cache.
 *
 * - `doc`: the document as saved; null when nothing is, undefined until it has loaded.
 * - `error`: the first load failed, or the listener did since. After a listener error `doc`
 *   is the last good copy, not an empty one.
 */
export function useConfigDocument(): {
  doc: UserConfig | null | undefined;
  adapter: ConfigAdapter | null;
  loading: boolean;
  error: Error | null;
} {
  const store = useContext(UserConfigContext);
  if (!store) throw new Error("useConfigDocument needs a UserConfigProvider above it");
  const { adapter, liveError } = store;

  const query = useQuery({
    queryKey: adapter?.queryKey ?? ["userConfig", "pending"],
    queryFn: () => adapter!.load(),
    enabled: adapter !== null,
    // The listener keeps the entry current; a refetch would only race it.
    staleTime: Infinity,
    // The listener retries a failing connection itself, and a load answers from it.
    retry: false,
  });

  return {
    doc: query.data,
    adapter,
    loading: adapter === null || query.isLoading,
    error: query.error ?? liveError,
  };
}
