import { describe, expect, it } from "vitest";
import { buildTraceparent, newNavigationTrace } from "./trace";

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
const ALL_ZERO_TRACE_ID = "0".repeat(32);

function parts(traceparent: string) {
  const [version, traceId, spanId, flags] = traceparent.split("-");
  return { version, traceId, spanId, flags };
}

describe("buildTraceparent", () => {
  it("emits a well-formed, sampled W3C traceparent", () => {
    const tp = buildTraceparent();
    expect(tp).toMatch(TRACEPARENT);
    const { version, traceId, flags } = parts(tp);
    expect(version).toBe("00");
    expect(flags).toBe("01");
    // A spec-invalid all-zero trace-id means lazy init didn't run.
    expect(traceId).not.toBe(ALL_ZERO_TRACE_ID);
  });

  it("works before any navigation event (lazy init on first use)", () => {
    // No newNavigationTrace() call here — the very first buildTraceparent()
    // in a fresh module must still yield a usable trace-id. (This file's
    // module state is isolated by Vitest, but assertions don't depend on
    // this being literally the first call.)
    expect(buildTraceparent()).toMatch(TRACEPARENT);
  });

  it("keeps the trace-id stable within one navigation", () => {
    newNavigationTrace();
    const a = parts(buildTraceparent());
    const b = parts(buildTraceparent());
    expect(a.traceId).toBe(b.traceId);
  });

  it("uses a fresh span-id per request", () => {
    newNavigationTrace();
    const a = parts(buildTraceparent());
    const b = parts(buildTraceparent());
    expect(a.spanId).not.toBe(b.spanId);
  });

  it("mints a new trace-id on each navigation", () => {
    newNavigationTrace();
    const first = parts(buildTraceparent()).traceId;
    newNavigationTrace();
    const second = parts(buildTraceparent()).traceId;
    expect(first).not.toBe(second);
  });
});
