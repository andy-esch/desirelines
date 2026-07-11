import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCameraController, type CameraController } from "./useCameraController";
import type { RegionSummary } from "../api/map";

const regionA: RegionSummary = {
  regionId: 1,
  name: "A",
  kind: "metro",
  activityCount: 1,
  bbox: [0, 0, 1, 1],
};
const regionB: RegionSummary = { ...regionA, regionId: 2, name: "B", bbox: [2, 2, 3, 3] };

type Args = { defaultViewport: RegionSummary | null; hasExplicitTarget: boolean };

describe("useCameraController", () => {
  it("issues no fit with no viewport and nothing selected", () => {
    const { result } = renderHook(() =>
      useCameraController({ defaultViewport: null, hasExplicitTarget: false })
    );
    expect(result.current.fitTo).toBeNull();
  });

  it("does not fit a region already known at mount (initialViewState frames it)", () => {
    // Seeded from the mount region → not re-issued as an imperative fit.
    const { result } = renderHook(() =>
      useCameraController({ defaultViewport: regionA, hasExplicitTarget: false })
    );
    expect(result.current.fitTo).toBeNull();
  });

  it("frames the default region once it resolves after mount (nothing selected)", () => {
    const { result, rerender } = renderHook<CameraController, Args>(
      (props) => useCameraController(props),
      { initialProps: { defaultViewport: null, hasExplicitTarget: false } }
    );
    expect(result.current.fitTo).toBeNull();

    rerender({ defaultViewport: regionA, hasExplicitTarget: false });
    expect(result.current.fitTo?.bbox).toEqual(regionA.bbox);
    expect(result.current.fitTo?.duration).toBe(0); // instant load-time frame
  });

  it("does not frame the default region while an explicit target owns the camera", () => {
    // This is the race-proofing: a region resolving after a deep-link/selection is
    // simply never issued as a fit, so it can't clobber the framed target.
    const { result, rerender } = renderHook<CameraController, Args>(
      (props) => useCameraController(props),
      { initialProps: { defaultViewport: null, hasExplicitTarget: false } }
    );
    rerender({ defaultViewport: regionA, hasExplicitTarget: true });
    expect(result.current.fitTo).toBeNull();
  });

  it("does not overwrite an active fit when the default region later resolves", () => {
    const { result, rerender } = renderHook<CameraController, Args>(
      (props) => useCameraController(props),
      { initialProps: { defaultViewport: null, hasExplicitTarget: false } }
    );
    // A gesture frames a target...
    act(() => result.current.requestFit([10, 10, 11, 11], 600));
    expect(result.current.fitTo?.bbox).toEqual([10, 10, 11, 11]);
    const nonce = result.current.fitTo!.nonce;

    // ...then the default region resolves while that target owns the camera — the
    // command must be left untouched (no clobber back to the whole region).
    rerender({ defaultViewport: regionA, hasExplicitTarget: true });
    expect(result.current.fitTo?.bbox).toEqual([10, 10, 11, 11]);
    expect(result.current.fitTo!.nonce).toBe(nonce);
  });

  it("re-frames on a genuine region change, but not on a same-region refetch", () => {
    const { result, rerender } = renderHook<CameraController, Args>(
      (props) => useCameraController(props),
      { initialProps: { defaultViewport: null, hasExplicitTarget: false } }
    );
    rerender({ defaultViewport: regionA, hasExplicitTarget: false });
    const first = result.current.fitTo;
    expect(first?.bbox).toEqual(regionA.bbox);

    // Same regionId, new object identity (background refetch) → no re-fit.
    rerender({ defaultViewport: { ...regionA }, hasExplicitTarget: false });
    expect(result.current.fitTo?.nonce).toBe(first?.nonce);

    // A genuine region change → re-fit with a bumped nonce.
    rerender({ defaultViewport: regionB, hasExplicitTarget: false });
    expect(result.current.fitTo?.bbox).toEqual(regionB.bbox);
    expect(result.current.fitTo!.nonce).toBeGreaterThan(first!.nonce);
  });

  it("does not snap to a region it intentionally skipped once the target clears", () => {
    const { result, rerender } = renderHook<CameraController, Args>(
      (props) => useCameraController(props),
      { initialProps: { defaultViewport: null, hasExplicitTarget: false } }
    );
    // Region resolves while a target is active → skipped (but marked handled).
    rerender({ defaultViewport: regionA, hasExplicitTarget: true });
    expect(result.current.fitTo).toBeNull();

    // Target clears → the camera must stay put, not jump to that region.
    rerender({ defaultViewport: regionA, hasExplicitTarget: false });
    expect(result.current.fitTo).toBeNull();
  });

  it("requestFit frames a bbox (eased by default) and bumps the nonce per call", () => {
    const { result } = renderHook(() =>
      useCameraController({ defaultViewport: null, hasExplicitTarget: false })
    );
    act(() => result.current.requestFit([5, 5, 6, 6]));
    expect(result.current.fitTo?.bbox).toEqual([5, 5, 6, 6]);
    expect(result.current.fitTo?.duration).toBe(600); // gesture ease default
    const n1 = result.current.fitTo!.nonce;

    act(() => result.current.requestFit([5, 5, 6, 6], 0));
    expect(result.current.fitTo?.duration).toBe(0);
    expect(result.current.fitTo!.nonce).toBeGreaterThan(n1); // re-issue re-fits
  });

  it("requestFit ignores a missing or malformed bbox", () => {
    const { result } = renderHook(() =>
      useCameraController({ defaultViewport: null, hasExplicitTarget: false })
    );
    act(() => result.current.requestFit(undefined));
    act(() => result.current.requestFit([1, 2, 3]));
    expect(result.current.fitTo).toBeNull();
  });
});
