import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDailySportData } from "./useDailySportData";

vi.mock("./useAuth", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("./useUserConfig", () => ({ useUserConfig: () => ({ data: undefined }) }));

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
