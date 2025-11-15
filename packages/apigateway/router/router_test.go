package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewRouter(t *testing.T) {
	router := NewRouter()

	if router == nil {
		t.Fatal("expected router to be non-nil")
	}

	if router.routes == nil {
		t.Fatal("expected routes map to be initialized")
	}

	if len(router.routes) != 0 {
		t.Errorf("expected empty routes map, got %d routes", len(router.routes))
	}
}

func TestRegisterRoute(t *testing.T) {
	router := NewRouter()

	// Create test handler
	testHandler := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}

	// Create test auth middleware
	testAuthMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
	}

	tests := []struct {
		name           string
		pattern        string
		requiresAuth   bool
		authMiddleware func(http.Handler) http.Handler
	}{
		{
			name:           "register route without auth",
			pattern:        "/health",
			requiresAuth:   false,
			authMiddleware: nil,
		},
		{
			name:           "register route with auth",
			pattern:        "/api/data",
			requiresAuth:   true,
			authMiddleware: testAuthMiddleware,
		},
		{
			name:           "register wildcard route",
			pattern:        "/activities/*",
			requiresAuth:   true,
			authMiddleware: testAuthMiddleware,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router.RegisterRoute(tt.pattern, testHandler, tt.requiresAuth, tt.authMiddleware)

			route, ok := router.routes[tt.pattern]
			if !ok {
				t.Fatalf("route %s not registered", tt.pattern)
			}

			if route.RequiresAuth != tt.requiresAuth {
				t.Errorf("expected RequiresAuth=%v, got %v", tt.requiresAuth, route.RequiresAuth)
			}

			if route.Handler == nil {
				t.Error("expected handler to be non-nil")
			}
		})
	}
}

func TestRegisterRoute_Overwrite(t *testing.T) {
	router := NewRouter()

	handler1 := func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("handler1"))
	}
	handler2 := func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("handler2"))
	}

	// Register first handler
	router.RegisterRoute("/test", handler1, false, nil)

	// Overwrite with second handler
	router.RegisterRoute("/test", handler2, true, nil)

	route, ok := router.routes["/test"]
	if !ok {
		t.Fatal("route not registered")
	}

	// Verify it was overwritten (check RequiresAuth changed)
	if !route.RequiresAuth {
		t.Error("expected route to be overwritten with RequiresAuth=true")
	}
}

func TestRoute_ExactMatch(t *testing.T) {
	router := NewRouter()
	called := false

	handler := func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}

	router.RegisterRoute("/health", handler, false, nil)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	matched := router.Route(w, req, "/health")

	if !matched {
		t.Error("expected route to match")
	}

	if !called {
		t.Error("expected handler to be called")
	}

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestRoute_NoMatch(t *testing.T) {
	router := NewRouter()

	handler := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}

	router.RegisterRoute("/health", handler, false, nil)

	req := httptest.NewRequest("GET", "/notfound", nil)
	w := httptest.NewRecorder()

	matched := router.Route(w, req, "/notfound")

	if matched {
		t.Error("expected route to not match")
	}
}

func TestRoute_WildcardMatch(t *testing.T) {
	tests := []struct {
		name        string
		pattern     string
		requestPath string
		shouldMatch bool
	}{
		{
			name:        "wildcard matches with trailing path",
			pattern:     "/activities/*",
			requestPath: "/activities/2024/metrics",
			shouldMatch: true,
		},
		{
			name:        "wildcard matches exact prefix",
			pattern:     "/activities/*",
			requestPath: "/activities/",
			shouldMatch: true,
		},
		{
			name:        "wildcard matches prefix without slash",
			pattern:     "/activities/*",
			requestPath: "/activities/123",
			shouldMatch: true,
		},
		{
			name:        "wildcard does not match different path",
			pattern:     "/activities/*",
			requestPath: "/users/123",
			shouldMatch: false,
		},
		{
			name:        "wildcard does not match partial prefix",
			pattern:     "/activities/*",
			requestPath: "/act",
			shouldMatch: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := NewRouter()
			called := false

			handler := func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			}

			router.RegisterRoute(tt.pattern, handler, false, nil)

			req := httptest.NewRequest("GET", tt.requestPath, nil)
			w := httptest.NewRecorder()

			matched := router.Route(w, req, tt.requestPath)

			if matched != tt.shouldMatch {
				t.Errorf("expected match=%v, got %v", tt.shouldMatch, matched)
			}

			if tt.shouldMatch && !called {
				t.Error("expected handler to be called")
			}

			if !tt.shouldMatch && called {
				t.Error("expected handler to not be called")
			}
		})
	}
}

func TestRoute_MultipleRoutes(t *testing.T) {
	router := NewRouter()
	healthCalled := false
	dataCalled := false

	healthHandler := func(w http.ResponseWriter, r *http.Request) {
		healthCalled = true
		w.WriteHeader(http.StatusOK)
	}

	dataHandler := func(w http.ResponseWriter, r *http.Request) {
		dataCalled = true
		w.WriteHeader(http.StatusOK)
	}

	router.RegisterRoute("/health", healthHandler, false, nil)
	router.RegisterRoute("/data", dataHandler, false, nil)

	// Test health route
	req1 := httptest.NewRequest("GET", "/health", nil)
	w1 := httptest.NewRecorder()
	router.Route(w1, req1, "/health")

	if !healthCalled {
		t.Error("expected health handler to be called")
	}
	if dataCalled {
		t.Error("expected data handler to not be called")
	}

	// Reset and test data route
	healthCalled = false
	dataCalled = false

	req2 := httptest.NewRequest("GET", "/data", nil)
	w2 := httptest.NewRecorder()
	router.Route(w2, req2, "/data")

	if healthCalled {
		t.Error("expected health handler to not be called")
	}
	if !dataCalled {
		t.Error("expected data handler to be called")
	}
}

func TestRoute_ExactMatchPrecedence(t *testing.T) {
	router := NewRouter()
	exactCalled := false
	wildcardCalled := false

	exactHandler := func(w http.ResponseWriter, r *http.Request) {
		exactCalled = true
		w.Write([]byte("exact"))
	}

	wildcardHandler := func(w http.ResponseWriter, r *http.Request) {
		wildcardCalled = true
		w.Write([]byte("wildcard"))
	}

	// Register both routes
	router.RegisterRoute("/activities/exact", exactHandler, false, nil)
	router.RegisterRoute("/activities/*", wildcardHandler, false, nil)

	req := httptest.NewRequest("GET", "/activities/exact", nil)
	w := httptest.NewRecorder()

	router.Route(w, req, "/activities/exact")

	if !exactCalled {
		t.Error("expected exact handler to be called")
	}
	if wildcardCalled {
		t.Error("expected wildcard handler to not be called (exact match should take precedence)")
	}
}

func TestHandleRoute_WithAuth(t *testing.T) {
	router := NewRouter()
	handlerCalled := false
	authCalled := false

	handler := func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	}

	authMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authCalled = true
			// Simulate auth check
			next.ServeHTTP(w, r)
		})
	}

	router.RegisterRoute("/protected", handler, true, authMiddleware)

	req := httptest.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()

	router.Route(w, req, "/protected")

	if !authCalled {
		t.Error("expected auth middleware to be called")
	}
	if !handlerCalled {
		t.Error("expected handler to be called")
	}
}

func TestHandleRoute_WithoutAuth(t *testing.T) {
	router := NewRouter()
	handlerCalled := false
	authCalled := false

	handler := func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	}

	authMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authCalled = true
			next.ServeHTTP(w, r)
		})
	}

	// Register route without requiring auth
	router.RegisterRoute("/public", handler, false, authMiddleware)

	req := httptest.NewRequest("GET", "/public", nil)
	w := httptest.NewRecorder()

	router.Route(w, req, "/public")

	if authCalled {
		t.Error("expected auth middleware to not be called for public route")
	}
	if !handlerCalled {
		t.Error("expected handler to be called")
	}
}

func TestHandleRoute_AuthMiddlewareNil(t *testing.T) {
	router := NewRouter()
	handlerCalled := false

	handler := func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	}

	// Register route requiring auth but with nil middleware (edge case)
	router.RegisterRoute("/protected", handler, true, nil)

	req := httptest.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()

	router.Route(w, req, "/protected")

	// Should still call handler (auth check in handleRoute protects against nil)
	if !handlerCalled {
		t.Error("expected handler to be called even with nil auth middleware")
	}
}

func TestRoute_RootPath(t *testing.T) {
	router := NewRouter()

	handler := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}

	router.RegisterRoute("/", handler, false, nil)

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	matched := router.Route(w, req, "/")

	if !matched {
		t.Error("expected root path to match")
	}
}
