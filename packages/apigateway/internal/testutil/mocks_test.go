package testutil

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
)

func TestActivityRepository_ErrFallsBackForQueriesOnly(t *testing.T) {
	down := errors.New("db down")
	specific := errors.New("not found")
	repo := &ActivityRepository{Err: down, ActivityErr: specific}

	if err := repo.Ping(context.Background()); err != nil {
		t.Errorf("Ping = %v, want nil: Err covers queries, PingErr covers Ping", err)
	}
	if _, err := repo.GetYearMetadata(context.Background(), "u", 2024); !errors.Is(err, down) {
		t.Errorf("GetYearMetadata error = %v, want the repository-wide Err", err)
	}
	if _, err := repo.GetActivityByID(context.Background(), "u", 1); !errors.Is(err, specific) {
		t.Errorf("GetActivityByID error = %v, want its own ActivityErr", err)
	}
}

func TestActivityRepository_RecordsFilters(t *testing.T) {
	repo := &ActivityRepository{}
	if repo.LastListFilter() != nil || repo.LastAggregateFilter() != nil {
		t.Fatal("filters recorded before any call")
	}

	if _, err := repo.ListActivities(context.Background(), repository.ActivityListFilter{UserID: "u", Limit: 5}); err != nil {
		t.Fatalf("ListActivities: %v", err)
	}
	if _, err := repo.AggregateActivities(context.Background(), repository.ActivityAggregateFilter{UserID: "u"}); err != nil {
		t.Fatalf("AggregateActivities: %v", err)
	}

	if f := repo.LastListFilter(); f == nil || f.Limit != 5 {
		t.Errorf("LastListFilter = %+v, want the Limit 5 filter", f)
	}
	if f := repo.LastAggregateFilter(); f == nil || f.UserID != "u" {
		t.Errorf("LastAggregateFilter = %+v, want user u's filter", f)
	}
}

func TestAuthMiddleware(t *testing.T) {
	serve := func(mw *AuthMiddleware) (status int, userID string) {
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID = middleware.GetUserID(r.Context())
			w.WriteHeader(http.StatusOK)
		})
		w := httptest.NewRecorder()
		mw.Middleware(next).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
		return w.Code, userID
	}

	t.Run("signs the request in as UserID", func(t *testing.T) {
		mw := &AuthMiddleware{UserID: "test-user"}
		if status, user := serve(mw); status != http.StatusOK || user != "test-user" {
			t.Errorf("got %d as %q, want 200 as test-user", status, user)
		}
		if !mw.Called() {
			t.Error("Called() = false after a request")
		}
	})

	t.Run("blocks before the handler", func(t *testing.T) {
		if status, user := serve(&AuthMiddleware{Block: true, UserID: "test-user"}); status != http.StatusUnauthorized || user != "" {
			t.Errorf("got %d as %q, want 401 with the handler not run", status, user)
		}
	})
}
