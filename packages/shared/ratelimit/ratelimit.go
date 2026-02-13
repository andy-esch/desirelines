package ratelimit

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"golang.org/x/time/rate"
)

// Config holds rate limiter settings.
type Config struct {
	// Rate is the number of requests allowed per second.
	Rate float64
	// Burst is the maximum burst size (token bucket capacity).
	Burst int
	// CleanupInterval is how often stale limiters are removed. Defaults to 1 minute.
	CleanupInterval time.Duration
	// TTL is how long an idle limiter is kept before removal. Defaults to 5 minutes.
	TTL time.Duration
}

func (c Config) cleanupInterval() time.Duration {
	if c.CleanupInterval > 0 {
		return c.CleanupInterval
	}
	return time.Minute
}

func (c Config) ttl() time.Duration {
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
type Limiter struct {
	mu      sync.Mutex
	clients map[string]*entry
	rate    rate.Limit
	burst   int
	ttl     time.Duration
	logger  *slog.Logger
}

// New creates a Limiter and starts a background goroutine that removes stale entries.
// The cleanup goroutine stops when ctx is cancelled.
func New(ctx context.Context, cfg Config, logger *slog.Logger) *Limiter {
	l := &Limiter{
		clients: make(map[string]*entry),
		rate:    rate.Limit(cfg.Rate),
		burst:   cfg.Burst,
		ttl:     cfg.ttl(),
		logger:  logger,
	}

	go l.cleanup(ctx, cfg.cleanupInterval())
	return l
}

// Middleware returns chi-compatible middleware that rejects requests exceeding the rate limit.
// It expects chiMiddleware.RealIP to have already run so that r.RemoteAddr contains the real client IP.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := stripPort(r.RemoteAddr)

		limiter := l.getLimiter(ip)
		if !limiter.Allow() {
			w.Header().Set("Retry-After", "1")
			gcplog.WriteError(w, r, gcplog.ErrRateLimited, l.logger)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// getLimiter returns the rate limiter for the given IP, creating one if needed.
func (l *Limiter) getLimiter(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()

	e, ok := l.clients[ip]
	if !ok {
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
