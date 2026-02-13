// Package ratelimit provides per-IP HTTP rate limiting middleware using a token bucket algorithm.
//
// It is designed for single-instance Cloud Run services where in-process state is sufficient.
// Stale per-IP limiters are automatically cleaned up in a background goroutine.
package ratelimit
