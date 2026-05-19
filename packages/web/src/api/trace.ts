/**
 * W3C trace-context propagation for browser → apigateway requests.
 *
 * This is **propagation only** — no browser OTel SDK, no collector. The
 * apigateway runs in public-endpoint mode (`otelhttp.WithPublicEndpointFn`,
 * see packages/apigateway/cmd/apigateway/main.go): it starts a fresh root
 * span per request and *links* the browser's span context rather than
 * parenting under it. So the browser trace-id is a correlation hint, never
 * a trusted parent — which is exactly what makes injecting it safe.
 *
 * One trace-id is minted per user navigation (wired to TanStack Router in
 * router.tsx) so every request a single navigation fires shares it. In
 * Cloud Trace that surfaces as "this click → these backend traces".
 */

/** Hex-encode `byteLength` cryptographically-random bytes. */
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Stable for the duration of one navigation; replaced by newNavigationTrace().
// Initialized lazily (see buildTraceparent) so requests fired before the
// first navigation event — e.g. the initial page load — still get a
// well-formed trace-id rather than an all-zero (spec-invalid) one.
let currentTraceId: string | null = null;

/**
 * Mint a fresh per-navigation trace-id. Call once at the start of every
 * user navigation; wired to TanStack Router's `onBeforeNavigate` in
 * router.tsx so all requests within one navigation share a trace-id.
 */
export function newNavigationTrace(): void {
  currentTraceId = randomHex(16); // 16 bytes → 32 hex chars
}

/**
 * Build a W3C `traceparent` header value:
 * `00-<32hex trace-id>-<16hex span-id>-01`.
 *
 * The sampled flag is always set. A fresh random span-id is generated per
 * request — the apigateway links (never parents), so the span-id is only a
 * correlation handle and need not correspond to a real browser-side span.
 */
export function buildTraceparent(): string {
  if (!currentTraceId) newNavigationTrace();
  return `00-${currentTraceId}-${randomHex(8)}-01`;
}
