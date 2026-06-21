import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAuthTokenRef } from "./useAuthTokenRef";

const mockAuthService = {
  waitForAuthReady: vi.fn().mockResolvedValue(undefined),
  getIdToken: vi.fn(),
};
let mockUser: { uid: string } | null = { uid: "u1" };

vi.mock("../contexts/ServiceContext", () => ({
  useAuthService: () => mockAuthService,
}));
vi.mock("./useAuth", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

describe("useAuthTokenRef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { uid: "u1" };
    mockAuthService.waitForAuthReady.mockResolvedValue(undefined);
  });

  it("waits for auth readiness, then exposes the token via state and getToken()", async () => {
    mockAuthService.getIdToken.mockResolvedValue("tok-123");

    const { result } = renderHook(() => useAuthTokenRef());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(mockAuthService.waitForAuthReady).toHaveBeenCalled();
    expect(result.current.token).toBe("tok-123");
    expect(result.current.getToken()).toBe("tok-123");
  });

  it("settles ready=true but leaves the token undefined when getIdToken fails", async () => {
    mockAuthService.getIdToken.mockRejectedValue(new Error("no token"));

    const { result } = renderHook(() => useAuthTokenRef());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.token).toBeUndefined();
    expect(result.current.getToken()).toBeUndefined();
  });

  it("force-refreshes the token on demand", async () => {
    mockAuthService.getIdToken.mockResolvedValue("tok-1");
    const { result } = renderHook(() => useAuthTokenRef());
    await waitFor(() => expect(result.current.token).toBe("tok-1"));

    mockAuthService.getIdToken.mockResolvedValue("tok-2");
    await act(async () => {
      await result.current.refresh();
    });

    expect(mockAuthService.getIdToken).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(result.current.token).toBe("tok-2"));
  });
});
