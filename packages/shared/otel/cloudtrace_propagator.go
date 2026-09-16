package otel

import (
	"context"
	"encoding/binary"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

const (
	// cloudTraceHeader is the HTTP header injected by Google Cloud infrastructure (Cloud Run, GFE).
	cloudTraceHeader = "x-cloud-trace-context"

	// cloudTraceHeaderFormat matches "TRACE_ID/SPAN_ID[;o=TRACE_FLAGS]"
	// TRACE_ID: 32 hex chars (128-bit)
	// SPAN_ID: 1-20 decimal digits (uint64)
	// TRACE_FLAGS: 1 digit (1 = sampled, 0 = not sampled)
	cloudTraceHeaderFormat = `^(?P<trace_id>[0-9a-fA-F]{32})/(?P<span_id>[0-9]{1,20})(?:;o=(?P<trace_flags>[0-9]+))?$`
)

var cloudTraceHeaderRe = regexp.MustCompile(cloudTraceHeaderFormat)

// cloudTraceOneWayPropagator is an extract-only propagator that reads the legacy
// Google Cloud trace context from X-Cloud-Trace-Context header injected by Cloud Run.
//
// Outgoing injection is intentionally a no-op: outgoing propagation is handled
// by W3C TraceContext (traceparent).
//
// Inlined here so we can retire the deprecated
// github.com/GoogleCloudPlatform/opentelemetry-operations-go/propagator package
// while continuing to capture trace IDs from Cloud Run on webhook entry points
// (e.g. Strava webhook calls) that carry only X-Cloud-Trace-Context.
type cloudTraceOneWayPropagator struct{}

var _ propagation.TextMapPropagator = cloudTraceOneWayPropagator{}

// Inject does not inject anything; outgoing propagation uses W3C traceparent.
func (cloudTraceOneWayPropagator) Inject(context.Context, propagation.TextMapCarrier) {}

// Fields returns empty because this propagator never injects headers.
func (cloudTraceOneWayPropagator) Fields() []string {
	return nil
}

// Extract extracts the SpanContext from X-Cloud-Trace-Context if present.
func (cloudTraceOneWayPropagator) Extract(ctx context.Context, carrier propagation.TextMapCarrier) context.Context {
	header := carrier.Get(cloudTraceHeader)
	if header == "" {
		return ctx
	}

	sc, err := spanContextFromXCTC(header)
	if err != nil || !sc.IsValid() {
		return ctx
	}

	return trace.ContextWithRemoteSpanContext(ctx, sc)
}

func spanContextFromXCTC(header string) (trace.SpanContext, error) {
	match := cloudTraceHeaderRe.FindStringSubmatch(strings.TrimSpace(header))
	if match == nil {
		return trace.SpanContext{}, fmt.Errorf("invalid %s header: %q", cloudTraceHeader, header)
	}

	traceIDStr := match[cloudTraceHeaderRe.SubexpIndex("trace_id")]
	spanIDStr := match[cloudTraceHeaderRe.SubexpIndex("span_id")]
	traceFlagsStr := match[cloudTraceHeaderRe.SubexpIndex("trace_flags")]

	// Reject all-zero trace ID or span ID (non-recording)
	if traceIDStr == strings.Repeat("0", 32) || spanIDStr == "0" {
		return trace.SpanContext{}, fmt.Errorf("non-recording trace/span ID in %s", header)
	}

	tid, err := trace.TraceIDFromHex(traceIDStr)
	if err != nil || !tid.IsValid() {
		return trace.SpanContext{}, fmt.Errorf("invalid trace ID %q: %w", traceIDStr, err)
	}

	sidUint, err := strconv.ParseUint(spanIDStr, 10, 64)
	if err != nil || sidUint == 0 {
		return trace.SpanContext{}, fmt.Errorf("invalid span ID %q: %w", spanIDStr, err)
	}

	var sidBytes [8]byte
	binary.BigEndian.PutUint64(sidBytes[:], sidUint)
	sid := trace.SpanID(sidBytes)

	flags := trace.TraceFlags(0x00)
	if traceFlagsStr == "1" {
		flags = trace.FlagsSampled
	}

	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    tid,
		SpanID:     sid,
		TraceFlags: flags,
		Remote:     true,
	}), nil
}
