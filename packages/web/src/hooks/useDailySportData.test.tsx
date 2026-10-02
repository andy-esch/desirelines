import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDailySportData } from "./useDailySportData";
import * as activitiesApi from "../api/activities";

const auth = vi.hoisted(() => ({ user: null as { uid: string } | null }));
vi.mock("./useAuth", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));
vi.mock("./usePreferences", () => ({ useTimezone: () => undefined }));

afterEach(() => {
  auth.user = null;
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("useDailySportData demo days", () => {
  const range = { year: 2026, from: "2026-09-14", to: "2026-09-20" };

  it("gives the same generated days to every request for the same sports and range", () => {
    const first = renderHook(
      () => useDailySportData({ ...range, sports: ["running", "cycling"] }),
      { wrapper }
    );
    const second = renderHook(
      () => useDailySportData({ ...range, sports: ["cycling", "running"] }),
      { wrapper }
    );
    expect(second.result.current.data).toBe(first.result.current.data);
  });

  it("generates separately for a different range", () => {
    const week = renderHook(() => useDailySportData({ ...range, sports: ["yoga"] }), { wrapper });
    const month = renderHook(
      () => useDailySportData({ ...range, from: "2026-09-01", sports: ["yoga"] }),
      { wrapper }
    );
    expect(month.result.current.data).not.toBe(week.result.current.data);
  });
});

describe("useDailySportData retry", () => {
  // Stable across renders, as the hook asks of its callers.
  const SPORTS = ["cycling"];

  it("fetches the days again after a failure", async () => {
    auth.user = { uid: "athlete" };
    const day = { distanceMeters: 1000, timeMinutes: 10, activities: 1, activityIds: [1] };
    const fetchDays = vi
      .spyOn(activitiesApi, "fetchMultiSportDailySummary")
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ cycling: { "2026-09-14": day } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => useDailySportData({ year: 2026, from: "2026-09-14", to: "2026-09-20", sports: SPORTS }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    );
    await waitFor(() => expect(result.current.error?.message).toBe("timeout"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data.cycling).toEqual({ "2026-09-14": day });
    expect(fetchDays).toHaveBeenCalledTimes(2);
  });
});
