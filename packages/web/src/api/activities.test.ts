import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchActivities } from "./activities";

// Stub the axios client so the tests see exactly the URL fetchActivities builds.
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./client", () => ({ default: () => ({ get }) }));

const requestedUrl = (): string => get.mock.calls[0]![0] as string;

describe("fetchActivities query serialization", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { activities: [], hasMore: false } });
  });

  it("joins sports into one comma-separated param", async () => {
    await fetchActivities({ sports: ["cycling", "running"], limit: 50 });
    const params = new URLSearchParams(requestedUrl().split("?")[1]);
    expect(params.get("sports")).toBe("cycling,running");
    expect(params.get("limit")).toBe("50");
  });

  it("omits the sports param entirely when no sports are selected (all sports)", async () => {
    await fetchActivities({ sports: [] });
    expect(requestedUrl()).not.toContain("sports=");
  });

  it("carries the date window and cursor through unchanged", async () => {
    await fetchActivities({
      sports: ["yoga"],
      from: "2026-01-01",
      to: "2026-06-30",
      cursor: "abc123",
    });
    const params = new URLSearchParams(requestedUrl().split("?")[1]);
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("to")).toBe("2026-06-30");
    expect(params.get("sports")).toBe("yoga");
    expect(params.get("cursor")).toBe("abc123");
  });
});
