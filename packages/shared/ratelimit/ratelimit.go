package ratelimit

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"golang.org/x/time/rate"
)

// defaultMaxClients is the maximum number of per-IP limiters tracked concurrently.
// This bounds memory usage to prevent OOM from IP-spoofing attacks.
const defaultMaxClients = 10000

// Config holds rate limiter settings.
type Config struct {
	// Rate is the number of requests allowed per second.
	Rate float64
	// Burst is the maximum burst size (token bucket capacity).
	Burst int
	// MaxClients is the maximum number of distinct IPs tracked. When full, new IPs
	// are rejected with 429 until stale entries are cleaned up. Defaults to 10,000.
	MaxClients int
	// CleanupInterval is how often stale limiters are removed. Defaults to 1 minute.
	CleanupInterval time.Duration
	// TTL is how long an idle limiter is kept before removal. Defaults to 5 minutes.
	TTL time.Duration
	// Skip, when non-nil and returning true for a request, bypasses this limiter
	// for that request entirely (no token consumed, never 429). Lets a caller
	// exempt a route class with a different request profile — e.g. bursty MVT
	// map tiles — from a limiter without restructuring the middleware chain.
	Skip func(*http.Request) bool
	// Name labels this limiter in the desirelines.io/ratelimit/rejected metric
	// (the "limiter" attribute), so a process running several limiters — e.g. the
	// apigateway's default/auth/tile — can tell which one is rejecting.
	Name string
	// Meter, when non-nil, is used to create the rejection counter. When nil the
	// limiter simply doesn't emit the metric (tests, or callers without OTel).
	Meter metric.Meter
}

func (c *Config) maxClients() int {
	if c.MaxClients > 0 {
		return c.MaxClients
	}
	return defaultMaxClients
}

func (c *Config) cleanupInterval() time.Duration {
	if c.CleanupInterval > 0 {
		return c.CleanupInterval
	}
	return time.Minute
}

func (c *Config) ttl() time.Duration {
	if c.TTL > 0 {
		return c.TTL
	}
	return 5 * time.Minute
}

// entry tracks a per-IP rate limiter and when it was last used.
type entry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// Limiter manages per-IP rate limiters with automatic stale cleanup.
// The number of tracked IPs is bounded by MaxClients to prevent memory exhaustion.
type Limiter struct {
	mu         sync.Mutex
	clients    map[string]*entry
	rate       rate.Limit
	burst      int
	maxClients int
	ttl        time.Duration
	skip       func(*http.Request) bool
	logger     *slog.Logger
	name       string
	rejected   metric.Int64Counter
}

// New creates a Limiter and starts a background goroutine that removes stale entries.
// The cleanup goroutine stops when ctx is canceled.
func New(ctx context.Context, cfg *Config, logger *slog.Logger) *Limiter {
	l := &Limiter{
		clients:    make(map[string]*entry),
		rate:       rate.Limit(cfg.Rate),
		burst:      cfg.Burst,
		maxClients: cfg.maxClients(),
		ttl:        cfg.ttl(),
		skip:       cfg.Skip,
		logger:     logger,
		name:       cfg.Name,
	}
	if cfg.Meter != nil {
		counter, err := cfg.Meter.Int64Counter(
			"desirelines.io/ratelimit/rejected",
			metric.WithDescription("Requests rejected by the rate limiter, by reason (over_limit|map_full) and limiter"),
		)
		if err != nil {
			logger.Warn("Failed to create ratelimit.rejected counter; rejections won't be metered", "error", err)
		} else {
			l.rejected = counter
		}
	}

	go l.cleanup(ctx, cfg.cleanupInterval())
	return l
}

// recordRejected increments the rejection counter (a no-op when no Meter was
// configured). reason is "over_limit" (the IP's token bucket is empty) or
// "map_full" (the per-IP client map is at capacity).
func (l *Limiter) recordRejected(ctx context.Context, reason string) {
	if l.rejected == nil {
		return
	}
	l.rejected.Add(ctx, 1, metric.WithAttributes(
		attribute.String("reason", reason),
		attribute.String("limiter", l.name),
	))
}

// reject writes the standard 429 response: the Retry-After header, the
// desirelines.io/ratelimit/rejected metric (by reason), and the JSON error body.
func (l *Limiter) reject(w http.ResponseWriter, r *http.Request, retryAfter, reason string) {
	w.Header().Set("Retry-After", retryAfter)
	l.recordRejected(r.Context(), reason)
	apierrors.WriteError(w, r, apierrors.ErrRateLimited, l.logger)
}

// Middleware returns chi-compatible middleware that rejects requests exceeding the rate limit.
// It expects gcplog.CloudRunRealIP to have already run so that r.RemoteAddr contains the real client IP.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Exempt requests the caller opts out (e.g. a bursty tile route handled by
		// its own limiter) before touching the per-IP token buckets.
		if l.skip != nil && l.skip(r) {
			next.ServeHTTP(w, r)
			return
		}

		ip := stripPort(r.RemoteAddr)

		limiter := l.getLimiter(ip)
		if limiter == nil {
			l.reject(w, r, "60", "map_full")
			return
		}

		// Reserve()+Cancel()-on-reject is how we read Delay() (for the Retry-After
		// header) while emulating Allow(). Per x/time/rate, Cancel() only fully
		// restores the token if no other Reserve/Allow ran on this limiter since —
		// so under same-IP concurrency the accounting is best-effort (marginally
		// stricter than the configured rate). Accepted: we need Delay(), which
		// Allow() doesn't expose.
		reservation := limiter.Reserve()
		delay := reservation.Delay()
		if delay == 0 {
			next.ServeHTTP(w, r)
			return
		}

		// Rate limited — cancel the reservation to return the token.
		reservation.Cancel()

		var retryAfter string
		if delay == rate.InfDuration {
			retryAfter = "3600"
		} else {
			seconds := math.Ceil(delay.Seconds())
			if seconds < 1 {
				seconds = 1
			}
			retryAfter = fmt.Sprintf("%.0f", seconds)
		}

		l.reject(w, r, retryAfter, "over_limit")
	})
}

// getLimiter returns the rate limiter for the given IP, creating one if needed.
// Returns nil if the IP is unknown and the client map is at capacity.
func (l *Limiter) getLimiter(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()

	e, ok := l.clients[ip]
	if !ok {
		if len(l.clients) >= l.maxClients {
			// Debug, not Warn: this fires once per request from every new IP while
			// the map is full — i.e. it amplifies exactly during the IP-rotation
			// flood the cap defends against. The alertable signal is the
			// desirelines.io/ratelimit/rejected counter (reason="map_full"); the
			// per-IP detail stays at Debug.
			l.logger.Debug("Rate limiter client map full, rejecting new IP",
				"ip", ip, "max_clients", l.maxClients)
			return nil
		}
		e = &entry{limiter: rate.NewLimiter(l.rate, l.burst)}
		l.clients[ip] = e
	}
	e.lastSeen = time.Now()
	return e.limiter
}

// cleanup periodically removes limiters that haven't been used within the TTL.
func (l *Limiter) cleanup(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.removeStale()
		}
	}
}

// removeStale removes entries older than the configured TTL.
func (l *Limiter) removeStale() {
	l.mu.Lock()
	defer l.mu.Unlock()

	cutoff := time.Now().Add(-l.ttl)
	removed := 0
	for ip, e := range l.clients {
		if e.lastSeen.Before(cutoff) {
			delete(l.clients, ip)
			removed++
		}
	}
	if removed > 0 {
		l.logger.Debug("Cleaned up stale rate limiters", "removed", removed, "remaining", len(l.clients))
	}
}

// stripPort removes the port suffix from an address (e.g. "1.2.3.4:5678" -> "1.2.3.4").
// If there is no port, the address is returned as-is.
func stripPort(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr // no port or already bare IP
	}
	return host
}
