import { useQuery } from "@tanstack/react-query";
import { fetchMapTileJSON, DEFAULT_TILE_META, type MapTileJSON } from "../api/map";
import { useAuth } from "./useAuth";

/** Query key for the routes-map TileJSON (zoom levels). */
export const mapTileJSONKey = (uid: string | undefined) => ["mapTileJSON", uid] as const;

/**
 * Fetch the routes-map zoom levels (min/max + the LOD switch) from the backend
 * TileJSON, so the map no longer hardcodes them. Static metadata — cached for the
 * session. Returns `DEFAULT_TILE_META` until it resolves, so the map renders with
 * sensible values immediately and updates in place if the backend differs.
 *
 * Query key includes `user?.uid` per the data-fetching convention; gated on an
 * authenticated user.
 */
export function useMapTileJSON(): MapTileJSON {
  const { user, loading: authLoading } = useAuth();

  const { data } = useQuery({
    queryKey: mapTileJSONKey(user?.uid),
    queryFn: ({ signal }) => fetchMapTileJSON(signal),
    enabled: !authLoading && !!user,
    staleTime: Infinity,
  });

  return data ?? DEFAULT_TILE_META;
}
