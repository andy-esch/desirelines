// Package httpadapter handles Strava subscription verification and webhook events.
//
// The [composition root] supplies ownership/admission checks, topic-specific
// publishers and the callback capability, wraps [Handler.RegisterRoutes] with
// tracing, and coordinates graceful shutdown.
//
// The [dispatcher README] documents supported endpoints, configuration and
// deauthorization behavior.
//
// [composition root]: https://github.com/andy-esch/desirelines/blob/main/packages/dispatcher/cmd/dispatcher/main.go
// [dispatcher README]: https://github.com/andy-esch/desirelines/blob/main/packages/dispatcher/README.md
package httpadapter
